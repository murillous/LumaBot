// Orçamento da transcrição que vai ao modelo e as duas compactações. Mais contexto não é mais
// inteligência (e custa a cada turno): o que passa do orçamento vira referência ou resumo.
// Nível 1, sem modelo: o texto longo de uma fala antiga vira um trecho com o ID, e o bot lê o
// resto pela tool `read_messages`. Nível 2, com modelo: as falas mais velhas viram um resumo
// rolante, que cita os IDs. A transcrição em si não muda: as falas resumidas continuam lá pelo ID.

import { z } from 'zod';
import { type AiTool, aiTool, fail, ok } from '#plugins/ai/tools.ts';
import { DEFAULT_SPEECH, DEFAULT_TEXTS, fill, type Speech } from './texts.ts';
import {
  body,
  type Entry,
  header,
  kindLabel,
  type Summary,
  seq,
  type Transcript,
  toTurns,
} from './transcript.ts';

/**
 * Tokens estimados de um texto, sem tokenizador (cada provider tem o seu). Três caracteres por
 * token erra para cima em português, o lado seguro de um teto.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

/** As últimas falas ficam inteiras: é delas que a conversa de agora depende. */
export const KEEP_FULL = 10;
/** Texto de fala antiga acima disso vira trecho. */
const LONG_TEXT = 400;
const EXCERPT = 160;
/** Marca padrão do texto cortado no nível 1; o sistema explica como ler o resto. */
export const CUT_MARK = DEFAULT_TEXTS.cutMark;

/**
 * Nível 1: as falas das pessoas fora das últimas `KEEP_FULL` com texto longo (um textão colado,
 * uma transcrição) viram um trecho com a marca. As do bot ficam: ele fala em balões curtos.
 */
export function shorten(entries: readonly Entry[], speech: Speech = DEFAULT_SPEECH): Entry[] {
  const old = entries.length - KEEP_FULL;
  return entries.map((e, i) =>
    i < old && !e.fromSelf && e.text && e.text.length > LONG_TEXT
      ? { ...e, text: `${e.text.slice(0, EXCERPT).trimEnd()}${speech.texts.cutMark}` }
      : e,
  );
}

/** As falas que o resumo ainda não cobre. */
export const unsummarized = (entries: readonly Entry[], summary: Summary | undefined): Entry[] =>
  summary ? entries.filter((e) => seq(e.ref) > seq(summary.through)) : [...entries];

/** Tokens estimados das falas como vão ao modelo (já com o nível 1). */
export const transcriptTokens = (
  entries: readonly Entry[],
  timeZone: string,
  speech: Speech = DEFAULT_SPEECH,
): number =>
  toTurns(shorten(entries, speech), timeZone, speech).reduce(
    (total, t) => total + estimateTokens(t.text),
    0,
  );

/**
 * Quantas falas do começo saem para o resto caber em `budget`. Serve aos dois usos: o que a
 * compactação dobra no resumo e, sem resumo possível, o que fica fora do prompt.
 */
export function overflow(
  entries: readonly Entry[],
  timeZone: string,
  budget: number,
  speech: Speech = DEFAULT_SPEECH,
): number {
  let cut = 0;
  while (cut < entries.length && transcriptTokens(entries.slice(cut), timeZone, speech) > budget) {
    cut += 1;
  }
  return cut;
}

/** Teto do resumo: ele mesmo entra no orçamento. */
export const SUMMARY_MAX_CHARS = 2400;

/** O pedido de sistema do resumo, com o nome do bot. */
export const compactInstructions = (name: string, speech: Speech = DEFAULT_SPEECH): string =>
  fill(speech.texts.compactInstructions, { name, maxChars: SUMMARY_MAX_CHARS / 2 });

/** O pedido de resumo: o anterior e as falas a dobrar, com o bot pelo nome. */
export function compactInput(
  previous: string | undefined,
  folded: readonly Entry[],
  timeZone: string,
  speech: Speech = DEFAULT_SPEECH,
): string {
  const { texts } = speech;
  const byRef = new Map(folded.map((e) => [e.ref, e]));
  const lines = folded.map(
    (e) =>
      `${header(e, timeZone, speech)} ${e.name}: ${e.fromSelf ? (e.text ?? '') : body(e, byRef, speech)}`,
  );
  return [
    previous ? fill(texts.compactPrevious, { summary: previous }) : texts.compactNone,
    fill(texts.compactNew, { lines: lines.join('\n') }),
  ].join('\n\n');
}

const MAX_READ = 10;

/**
 * `read_messages`: o texto inteiro de falas pelo ID, o par do nível 1 (a fala cortada) e do
 * resumo (que cita IDs de falas que não estão mais no prompt).
 */
export function readMessagesTool(transcript: Transcript, speech: Speech = DEFAULT_SPEECH): AiTool {
  const { texts } = speech;
  return aiTool({
    name: 'read_messages',
    description: fill(texts.toolReadMessages, { cutMark: texts.cutMark }),
    args: z.object({
      ids: z.array(z.string().min(1)).min(1).max(MAX_READ).describe(texts.toolReadMessagesIds),
    }),
    sideEffects: false,
    run: async ({ ids }, t) => {
      const chatId = t.message.chat.id;
      const messages = [];
      for (const id of ids) {
        const e = transcript.get(chatId, id);
        if (!e) return fail('unknown', id);
        messages.push({
          id: `#${e.ref}`,
          from: e.name,
          text: e.text ?? '',
          ...(e.media && { media: kindLabel(e.media, speech) }),
        });
      }
      return ok({ messages });
    },
  });
}
