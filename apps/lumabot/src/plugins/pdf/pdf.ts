import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { aiTool, fail, mediaMessage, ok } from '#plugins/ai-tools.ts';
import { attempt, mediaOf, usage } from '#plugins/media-command.ts';
import { imageToPdf, mergePdfs } from './convert.ts';

/**
 * Textos ao usuário; a config do bot sobrescreve cada um (`messages`). `{prefix}` é o prefixo do
 * chat, e os demais placeholders vêm do comando (`ctx.t`).
 */
const MESSAGES = {
  pdfUsage:
    'ℹ️ Envie uma imagem com {prefix}pdf ou responda a uma imagem com {prefix}pdf nome do arquivo',
  mergeUsage:
    'ℹ️ Envie/responda PDFs com {prefix}mergepdf para adicionar. Finalize com {prefix}mergepdf done nome do arquivo. Use {prefix}mergepdf clear para cancelar.',
  mergeAdded: '📎 PDF adicionado ({count}).',
  mergeNeedMore: 'ℹ️ Adicione pelo menos 2 PDFs antes de finalizar.',
  mergeCleared: '🗑️ Lista de PDFs limpa.',
  mergeFull:
    '❌ A lista de PDFs passou de 50 MB. Finalize com {prefix}mergepdf done ou limpe com {prefix}mergepdf clear.',
  conversionError: '❌ Erro na conversão',
};

const TIMEOUT_MS = 60_000;
/** A fila do `!mergepdf` vive em memória: teto de bytes e validade contra quem não finaliza. */
const MERGE_MAX_BYTES = 50 * 1024 * 1024;
const MERGE_TTL_MS = 30 * 60_000;
const PDF_MIMETYPE = 'application/pdf';

interface PendingMerge {
  readonly pdfs: Buffer[];
  bytes: number;
  expiresAt: number;
}

/** Imagem → PDF (`!pdf`) e junção de PDFs (`!mergepdf`). Cada bot chama `pdf()` e ganha a própria fila. */
export function pdf(): PluginDefinition {
  // Chave: chat + remetente, para duas pessoas no mesmo grupo não juntarem PDFs uma da outra.
  const merges = new Map<string, PendingMerge>();

  return definePlugin({
    name: 'pdf',
    version: '0.0.0',
    engine: '<1.0.0',
    requires: ['media.download', 'send.document'],
    messages: MESSAGES,
    setup: (ctx) => {
      const fileName = z.string().optional().describe('Nome do arquivo, sem extensão');
      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'image_to_pdf',
          description:
            'Converte em PDF a imagem da mensagem do usuário ou da que ele respondeu, e envia no chat.',
          args: z.object({ fileName }),
          run: async ({ fileName = '' }, t) => {
            const source = mediaMessage(t.message, ['image']);
            if (!source) return fail('no-image');
            await t.reply.document(await imageToPdf(await source.media.download()), {
              fileName: pdfFileName(fileName, 'imagem.pdf'),
              mimetype: PDF_MIMETYPE,
            });
            return ok();
          },
        }),
      );
      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'merge_pdfs',
          description:
            'Junta num PDF só, na ordem, os PDFs anexados à mensagem do usuário e à que ele respondeu, e envia no chat. Precisa de pelo menos 2.',
          args: z.object({ fileName }),
          run: async ({ fileName = '' }, t) => {
            const pdfs = [t.message.quoted, t.message]
              .flatMap((m) => m?.attachments ?? [])
              .filter((a) => a.mimetype === PDF_MIMETYPE);
            if (pdfs.length < 2) return fail('need-two-pdfs');
            // Com o tamanho informado, recusa antes de baixar; sem ele, depois.
            if (pdfs.reduce((sum, a) => sum + (a.size ?? 0), 0) > MERGE_MAX_BYTES) {
              return fail('too-large');
            }
            const files = await Promise.all(pdfs.map((a) => a.download()));
            if (files.reduce((sum, f) => sum + f.length, 0) > MERGE_MAX_BYTES) {
              return fail('too-large');
            }
            const merged = await mergePdfs(files);
            await t.reply.document(merged, {
              fileName: pdfFileName(fileName, 'pdf-juntado.pdf'),
              mimetype: PDF_MIMETYPE,
            });
            return ok();
          },
        }),
      );
    },
    commands: {
      pdf: {
        description: 'Imagem → PDF (`!pdf nome do arquivo`)',
        accepts: ['image', 'quoted:image'],
        onReject: usage('pdfUsage'),
        timeoutMs: TIMEOUT_MS,
        run: (ctx) =>
          attempt(ctx, async () => {
            const pdf = await imageToPdf(await mediaOf(ctx).download());
            await ctx.reply.document(pdf, {
              fileName: pdfFileName(ctx.rawArgs, 'imagem.pdf'),
              mimetype: PDF_MIMETYPE,
            });
          }),
      },

      mergepdf: {
        aliases: ['joinpdf'],
        description: 'Junta PDFs: adicione um por vez, `done nome` finaliza, `clear` cancela',
        // `text` por último: o `done` e o `clear` vêm sem PDF.
        accepts: [`document:${PDF_MIMETYPE}`, `quoted:document:${PDF_MIMETYPE}`, 'text'],
        onReject: (ctx) => ctx.t('mergeUsage'),
        timeoutMs: TIMEOUT_MS,
        run: async (ctx) => {
          const key = `${ctx.message.chat.id}:${ctx.message.sender.id}`;
          dropExpired(merges);
          const [action = '', ...rest] = ctx.args;

          if (/^(clear|limpar|cancelar)$/i.test(action)) {
            merges.delete(key);
            return ctx.t('mergeCleared');
          }

          if (/^(done|pronto|finalizar)$/i.test(action)) {
            const pending = merges.get(key);
            if (!pending || pending.pdfs.length < 2) return ctx.t('mergeNeedMore');
            const failed = await attempt(ctx, async () => {
              await ctx.reply.document(await mergePdfs(pending.pdfs), {
                fileName: pdfFileName(rest.join(' '), 'pdf-juntado.pdf'),
                mimetype: PDF_MIMETYPE,
              });
            });
            // Falhou: a lista fica, para a pessoa tentar de novo ou limpar.
            if (!failed) merges.delete(key);
            return failed;
          }

          const source = ctx.media;
          if (!source) return ctx.t('mergeUsage');
          const pending = merges.get(key) ?? { pdfs: [], bytes: 0, expiresAt: 0 };
          // Com o tamanho informado, recusa antes de baixar.
          if (pending.bytes + (source.size ?? 0) > MERGE_MAX_BYTES) return ctx.t('mergeFull');
          let reply: string | undefined;
          const failed = await attempt(ctx, async () => {
            const pdf = await source.download();
            if (pending.bytes + pdf.length > MERGE_MAX_BYTES) {
              reply = ctx.t('mergeFull');
              return;
            }
            pending.pdfs.push(pdf);
            pending.bytes += pdf.length;
            pending.expiresAt = Date.now() + MERGE_TTL_MS;
            merges.set(key, pending);
            reply = ctx.t('mergeAdded', { count: pending.pdfs.length });
          });
          return failed ?? reply;
        },
      },
    },
  });
}

/** Nome digitado → `nome-do-arquivo.pdf`, sem acento nem símbolo; vazio, o `fallback`. */
function pdfFileName(raw: string, fallback: string): string {
  const slug = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug ? `${slug}.pdf` : fallback;
}

function dropExpired(merges: Map<string, PendingMerge>): void {
  const now = Date.now();
  for (const [key, pending] of merges) {
    if (pending.expiresAt <= now) merges.delete(key);
  }
}
