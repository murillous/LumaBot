// O que o contexto põe no prompt: as seções do sistema que explicam como ler a transcrição e a
// memória, e as mensagens (resumo, transcrição e a fala de agora). Quem é o bot (identidade,
// estilo, formato) fica com quem chama. Puro: nada de bot, storage ou relógio.

import type { ModelMessage } from 'ai';
import { CUT_MARK } from './context.ts';
import type { Turn } from './transcript.ts';

export interface PromptImage {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

/** Seção do sistema: como ler a transcrição, as marcas e as citações. */
export const READING_GUIDE = `# Como ler a conversa
1. A conversa chega como turnos. Os seus turnos são as suas próprias falas, para quem quer que tenha sido. As falas das pessoas chegam como linhas "[#m12 16:30] Nome: mensagem"; num grupo, várias pessoas aparecem no mesmo turno. O cabeçalho serve só para você saber quem falou, quando e qual é a mensagem: nunca escreva cabeçalhos, IDs ou prefixos como "Nome:" ou "Luma:" na resposta.
2. A linha marcada com ➜ é a que falou com você agora: responda a ela. A linha "[hoje é ...]" logo antes dela diz a data de hoje. As outras linhas são o que rolou no chat; use como contexto, sem responder a cada uma.
3. "(respondendo #m9)" quer dizer que a pessoa citou a mensagem #m9; "(respondendo à sua fala ...)", que citou uma fala sua. "[figurinha]", "[imagem]", "[áudio]", "[vídeo]" e "[documento]" marcam a mídia que a pessoa mandou. Você só vê a imagem que vem anexada à fala de agora: reaja a ela do seu jeito, entendendo o que tem nela (numa figurinha, a emoção). Para olhar ou usar uma mídia anterior (editar, juntar, comparar), passe o ID dela às ferramentas. "[documento: nome.pdf]" é um arquivo .pdf: para saber o que ele diz, leia com a ferramenta de ler pdf, nunca invente o conteúdo.
4. Uma mensagem que termina em "${CUT_MARK}" foi encurtada, e "[resumo da conversa até aqui]" resume o que veio antes da transcrição. Para ler uma mensagem inteira, passe o ID dela às ferramentas.
5. Mensagens curtas e vagas ("não sei", "sim", "ok", "continua", "e aí", "qual?") continuam o que você disse logo antes a essa pessoa; não as trate como mensagem solta.
6. Se a mensagem de agora muda claramente de assunto, siga o assunto novo sem forçar ligação com o anterior.
7. Não repita o nome da pessoa o tempo todo. Converse como no WhatsApp de verdade.`;

/**
 * Seção do sistema sobre a memória longa, com os blocos do chat no fim. Ela fecha o sistema:
 * os blocos só mudam quando o bot lembra ou esquece algo, então o prefixo antes deles segue em
 * cache.
 */
export function memoryGuide(memory?: string): string {
  return `# Memória
Você esquece a conversa depois de umas horas. Para guardar um fato duradouro (um gosto, um apelido, como a pessoa quer ser chamada, um combinado do grupo), use a ferramenta de lembrar; quando pedirem para esquecer, ou um fato ficar errado, a de esquecer. Guarde só o que vale por semanas, nunca o que é passageiro.${
    memory
      ? `

# O que você lembra deste chat
${memory}`
      : ''
  }`;
}

/** Abre o resumo na conversa; o sistema explica como lê-lo. */
const SUMMARY_LABEL = '[resumo da conversa até aqui]';

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
export function contextMessages(input: ContextMessagesInput): ModelMessage[] {
  const { history, senderName, userText, header, today, image, summary } = input;

  // O resumo vem antes da transcrição, como fala do usuário: no sistema ele mudaria o prefixo
  // a cada compactação, e alguns providers exigem que a conversa comece por uma fala do usuário.
  const turns: Turn[] = summary ? [{ role: 'user', text: `${SUMMARY_LABEL}\n${summary}` }] : [];
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
  const current = today ? `[hoje é ${today}]\n${marked}` : marked;
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
