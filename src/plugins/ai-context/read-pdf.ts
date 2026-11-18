// `read_pdf`: o bot lê PDFs do chat pelo ID da transcrição (ou o da mensagem e da citada). O texto
// sai local, pelo PDF.js (`unpdf`), sem custo de IA; só o PDF grande demais (resumo) e o escaneado
// (sem texto, lido pela cadeia de visão) custam uma chamada à parte, no uso de quem pediu.

import { type Media, MediaExpiredError, type MediaRefs, type Message } from '@usebridger/core';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { AiService, ModelChainItem } from '#plugins/ai/ai.ts';
import { type AiTool, type AiToolResult, aiTool, fail, ok } from '#plugins/ai-tools.ts';
import { personId } from '#plugins/person-id.ts';
import { lookupMedia } from './media.ts';
import { DEFAULT_SPEECH, fill, type Speech } from './texts.ts';
import type { Transcript } from './transcript.ts';

/** PDF maior que isso não é baixado: pesa na memória do processo e passa do limite dos providers. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Texto acima disso não vai cru ao modelo da conversa: vira resumo numa chamada à parte. */
export const MAX_PDF_TEXT = 30_000;
/** O que o resumo lê, no máximo; o resto o bot pede por `pages`. */
const MAX_SUMMARY_INPUT = 200_000;
/** Quantos PDFs o bot lê de uma vez, como no `view_media`. */
const MAX_PDFS = 4;

/** Por que o PDF não abre: com senha ou corrompido. */
export class PdfUnreadableError extends Error {
  override readonly name = 'PdfUnreadableError';
  readonly reason: 'encrypted' | 'invalid';
  constructor(reason: 'encrypted' | 'invalid') {
    super(`PDF ${reason}`);
    this.reason = reason;
  }
}

export interface PdfText {
  readonly totalPages: number;
  /** Texto de cada página, na ordem; `''` na página sem texto (imagem escaneada). */
  readonly pages: readonly string[];
}

/** Texto do PDF, por página. Lança `PdfUnreadableError` no PDF com senha ou inválido. */
export async function pdfText(data: Uint8Array): Promise<PdfText> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Cópia: o PDF.js toma posse do buffer, e o original ainda pode ir para a cadeia de visão.
    doc = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') throw new PdfUnreadableError('encrypted');
    if (name === 'InvalidPDFException') throw new PdfUnreadableError('invalid');
    throw err;
  }
  try {
    const { totalPages, text } = await extractText(doc, { mergePages: false });
    return { totalPages, pages: text.map((p) => p.replace(/[ \t]+/g, ' ').trim()) };
  } finally {
    // Libera o documento no worker do PDF.js; sem isso a memória fica presa até o GC.
    await doc.loadingTask.destroy();
  }
}

/** Faixa `"3-7"`, `"5"` ou `"3-"` em páginas de 1 a `total`; `null` se não fizer sentido. */
export function pageRange(
  spec: string | undefined,
  total: number,
): { readonly from: number; readonly to: number } | null {
  if (spec === undefined) return { from: 1, to: total };
  const m = /^\s*(\d+)\s*(?:(-)\s*(\d*))?\s*$/.exec(spec);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? (m[3] ? Number(m[3]) : total) : from;
  if (from < 1 || from > total || to < from) return null;
  return { from, to: Math.min(to, total) };
}

const isPdf = (media: Media, fileName?: string | null): boolean =>
  media.mimetype.startsWith('application/pdf') ||
  (fileName ?? media.fileName ?? '').toLowerCase().endsWith('.pdf');

/** Como terminou a leitura, para quem conta o uso. */
export type ReadOutcome = 'ok' | 'refused' | 'error';

interface ReadPdfDeps {
  readonly transcript: Transcript;
  readonly refs: MediaRefs;
  readonly ai: AiService;
  /** Cadeia que resume o PDF grande; vazia usa a principal do `ai`. */
  readonly models: readonly ModelChainItem[];
  /** Cadeia que lê PDF escaneado (precisa aceitar PDF, como o Gemini); vazia: não lê. */
  readonly readers: readonly ModelChainItem[];
  /** Avisado ao fim de cada leitura, para quem conta o uso (o `usage`). Nunca leva o texto. */
  readonly onRead?: (message: Message, outcome: ReadOutcome) => Promise<void>;
  readonly speech?: Speech;
}

interface Source {
  /** `#m4`, ou `anexo` se a mensagem não entrou na transcrição. */
  readonly id: string;
  readonly name: string;
  readonly media: Media;
}

type Found = { readonly sources: Source[] } | { readonly refused: AiToolResult };

/** Os PDFs pedidos: pelos IDs ou, sem eles, o da mensagem e o da citada. */
function findSources(
  { transcript, refs }: ReadPdfDeps,
  message: Message,
  ids: readonly string[] | undefined,
): Found {
  const chatId = message.chat.id;
  const sources: Source[] = [];
  if (ids && ids.length > 0) {
    for (const id of ids) {
      const found = lookupMedia(transcript, refs, chatId, id);
      if (!found.found) return { refused: fail(found.reason, id) };
      const entry = transcript.get(chatId, id);
      const fileName = found.media.fileName ?? entry?.fileName;
      if (found.type !== 'document' || !isPdf(found.media, fileName)) {
        return { refused: fail('not-pdf', id) };
      }
      sources.push({
        id: `#${entry?.ref ?? id.replace(/^#/, '')}`,
        name: fileName ?? 'documento.pdf',
        media: found.media,
      });
    }
    return { sources };
  }
  for (const m of [message, message.quoted]) {
    if (m?.type !== 'document' || !isPdf(m.media, m.fileName)) continue;
    const ref = transcript.find(chatId, m.id)?.ref;
    sources.push({
      id: ref ? `#${ref}` : 'anexo',
      name: m.fileName ?? m.media.fileName ?? 'documento.pdf',
      media: m.media,
    });
  }
  return sources.length > 0 ? { sources } : { refused: fail('no-pdf') };
}

/**
 * `read_pdf`: lê PDFs do chat e devolve o texto por página, para resumir e responder perguntas.
 * Nada do texto é guardado: a cada pergunta o bot lê de novo pelo ID, enquanto a fala estiver na
 * transcrição.
 */
export function readPdfTool(deps: ReadPdfDeps): AiTool {
  const { ai, models, readers, onRead } = deps;
  const { texts } = deps.speech ?? DEFAULT_SPEECH;
  return aiTool({
    name: 'read_pdf',
    description: texts.toolReadPdf,
    args: z.object({
      ids: z.array(z.string().min(1)).max(MAX_PDFS).optional().describe(texts.toolReadPdfIds),
      pages: z.string().optional().describe(texts.toolReadPdfPages),
      question: z.string().optional().describe(texts.toolReadPdfQuestion),
    }),
    requires: ['media.download'],
    sideEffects: false,
    run: async ({ ids, pages, question }, t) => {
      const chatId = t.message.chat.id;
      const actor = { id: personId(t.message.sender), chatId };
      // O uso vai para quem observa; o custo das chamadas à parte vem pelo `actor`.
      const used = async (outcome: ReadOutcome) => {
        await onRead?.(t.message, outcome);
      };
      const refuse = async (result: AiToolResult) => {
        await used('refused');
        return result;
      };

      const found = findSources(deps, t.message, ids);
      if ('refused' in found) return refuse(found.refused);

      const read = [];
      const sections: string[] = [];
      try {
        for (const { id, name, media } of found.sources) {
          if (media.size !== null && media.size > MAX_PDF_BYTES)
            return refuse(fail('too-large', id));
          let data: Buffer;
          try {
            data = await media.download();
          } catch (err) {
            if (err instanceof MediaExpiredError) return refuse(fail('expired', id));
            throw err;
          }
          if (data.length > MAX_PDF_BYTES) return refuse(fail('too-large', id));
          let pdf: PdfText;
          try {
            pdf = await pdfText(data);
          } catch (err) {
            if (err instanceof PdfUnreadableError) return refuse(fail(err.reason, id));
            throw err;
          }
          const range = pageRange(pages, pdf.totalPages);
          if (!range) {
            return refuse(
              fail('invalid-pages', fill(texts.pdfPageCount, { id, total: pdf.totalPages })),
            );
          }
          const header = fill(texts.pdfHeader, {
            id,
            name,
            from: range.from,
            to: range.to,
            total: pdf.totalPages,
          });
          const chosen = pdf.pages.slice(range.from - 1, range.to);
          let body: string;
          if (chosen.some((p) => p.length > 0)) {
            body = chosen
              .map(
                (p, i) =>
                  `${fill(texts.pdfPage, { page: range.from + i })}\n${p || texts.pdfEmptyPage}`,
              )
              .join('\n\n');
          } else {
            // Sem texto nenhum: páginas escaneadas. Só um modelo que lê PDF tira o texto delas.
            if (readers.length === 0) return refuse(fail('no-text', id));
            const pagesAsk = fill(texts.pdfAskPages, {
              from: range.from,
              to: range.to,
              total: pdf.totalPages,
            });
            const ask = question ? `${pagesAsk} ${fill(texts.question, { question })}` : pagesAsk;
            const { text } = await ai.generate({
              purpose: 'ai-context.pdf',
              instructions: texts.pdfReadScanned,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'file', data, mediaType: 'application/pdf', filename: name },
                    { type: 'text', text: ask },
                  ],
                },
              ],
              signal: t.signal,
              actor,
              models: readers,
            });
            body = `${texts.pdfScanned}\n${text.trim()}`;
          }
          sections.push(`${header}\n${body}`);
          read.push({ id, name, totalPages: pdf.totalPages, pages: `${range.from}-${range.to}` });
        }

        const text = sections.join('\n\n');
        if (text.length <= MAX_PDF_TEXT) {
          await used('ok');
          return ok({ pdfs: read, text });
        }
        // Grande demais para o contexto da conversa: uma chamada à parte resume e responde.
        const truncated = text.length > MAX_SUMMARY_INPUT;
        const input = truncated ? text.slice(0, MAX_SUMMARY_INPUT) : text;
        const { text: summary } = await ai.generate({
          purpose: 'ai-context.pdf',
          instructions: texts.pdfSummarize,
          messages: [
            {
              role: 'user',
              content: question ? `${input}\n\n${fill(texts.question, { question })}` : input,
            },
          ],
          signal: t.signal,
          actor,
          ...(models.length > 0 && { models }),
        });
        await used('ok');
        return ok({
          pdfs: read,
          summary: summary.trim(),
          note: truncated ? texts.pdfNoteTruncated : texts.pdfNoteSummarized,
        });
      } catch (err) {
        await used('error');
        throw err;
      }
    },
  });
}
