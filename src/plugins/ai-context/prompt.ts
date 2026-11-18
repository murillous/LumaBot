// O que o contexto põe no prompt: as seções do sistema que explicam como ler a transcrição e a
// memória, e as mensagens (resumo, transcrição e a fala de agora). Quem é o bot (identidade,
// estilo, formato) fica com quem chama. Puro: nada de bot, storage ou relógio.

import type { ModelMessage } from 'ai';
import { DEFAULT_SPEECH, fill, type Speech } from './texts.ts';
import type { Turn } from './transcript.ts';

export interface PromptImage {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

/** Seção do sistema: como ler a transcrição, as marcas e as citações. `name` é o do bot. */
export const readingGuide = (name: string, speech: Speech = DEFAULT_SPEECH): string =>
  fill(speech.texts.readingGuide, { name, cutMark: speech.texts.cutMark });

/**
 * Seção do sistema sobre a memória longa, com os blocos do chat no fim. Ela fecha o sistema:
 * os blocos só mudam quando o bot lembra ou esquece algo, então o prefixo antes deles segue em
 * cache.
 */
export function memoryGuide(memory?: string, speech: Speech = DEFAULT_SPEECH): string {
  const { texts } = speech;
  return memory ? `${texts.memoryGuide}\n\n${texts.memoryHeader}\n${memory}` : texts.memoryGuide;
}

export interface ContextMessagesInput {
  /** Quem fala agora; entra como rótulo da mensagem para o bot distinguir as pessoas. */
  readonly senderName: string;
  readonly userText: string;
  /** Cabeçalho da fala de agora (`[#m12 16:30]`); a linha ganha a marca `➜`. */
  readonly header?: string;
  /**
   * O dia de hoje (`terça-feira, 17/11/2026`), numa linha antes da fala de agora: nada que muda a
   * cada turno vai no sistema.
   */
  readonly today?: string;
  readonly image?: PromptImage;
  /** Resumo das falas mais velhas do chat (a compactação), antes da transcrição. */
  readonly summary?: string;
  readonly history: readonly Turn[];
}

/** As mensagens da conversa: o resumo, a transcrição e a fala de agora (com a imagem). */
export function contextMessages(
  input: ContextMessagesInput,
  speech: Speech = DEFAULT_SPEECH,
): ModelMessage[] {
  const { history, senderName, userText, header, today, image, summary } = input;
  const { texts } = speech;

  // O resumo vem antes da transcrição, como fala do usuário: no sistema ele mudaria o prefixo
  // a cada compactação, e alguns providers exigem que a conversa comece por uma fala do usuário.
  const turns: Turn[] = summary
    ? [{ role: 'user', text: `${texts.summaryLabel}\n${summary}` }]
    : [];
  for (const turn of history) {
    const last = turns.at(-1);
    if (last?.role === turn.role)
      turns[turns.length - 1] = { ...last, text: `${last.text}\n${turn.text}` };
    else turns.push(turn);
  }
  // A poda do histórico pode ter cortado um par pelo meio.
  while (turns[0]?.role === 'assistant') turns.shift();

  const line = `${senderName}: ${userText}`;
  const marked = header ? `${header} ➜ ${line}` : line;
  const current = today ? `${fill(texts.todayLine, { date: today })}\n${marked}` : marked;
  // O que as pessoas disseram desde a última fala do bot e a fala de agora são um turno só: dois
  // turnos `user` seguidos confundem alguns providers.
  const merged = turns.at(-1)?.role === 'user' ? turns.pop() : undefined;
  const text = merged ? `${merged.text}\n${current}` : current;

  const messages: ModelMessage[] = turns.map((t) => ({ role: t.role, content: t.text }));
  messages.push({
    role: 'user',
    content: image
      ? [
          { type: 'text', text },
          // `file` com `image/*`: a parte `image` está obsoleta no AI SDK 7.
          { type: 'file', data: image.data, mediaType: image.mediaType },
        ]
      : text,
  });
  return messages;
}
