// A decisão da reação espontânea, sem bot nem IA: o pedido ao modelo e a leitura da resposta.

import type { WindowEntry } from '#plugins/chat-window.ts';

/** O que o modelo diz para não reagir. */
export const NONE = 'nenhuma';

const INSTRUCTIONS = (emojis: readonly string[]) =>
  'Você é a Luma, numa conversa de grupo no WhatsApp. Abaixo estão as mensagens recentes, e a ÚLTIMA é a ' +
  'que você pode reagir com um emoji, como uma pessoa reagiria lendo o grupo.\n\n' +
  `Responda APENAS com UM destes emojis: ${emojis.join(' ')}\n` +
  `ou com a palavra ${NONE} se não vale reagir. Na dúvida, ${NONE}: reagir a tudo é chato. ` +
  'Escolha o emoji pelo clima da última mensagem e do contexto, não por sorteio. ' +
  'Não escreva mais nada, nem explicação, nem pontuação.';

/** O pedido ao modelo: a conversa recente, da mais antiga à mais nova. */
export function reactionPrompt(
  window: readonly WindowEntry[],
  emojis: readonly string[],
): { instructions: string; content: string } {
  return {
    instructions: INSTRUCTIONS(emojis),
    content: `Conversa:\n${window.map((m) => `${m.name}: ${m.text}`).join('\n')}`,
  };
}

// O seletor de variação (U+FE0F) distingue "👁" de "👁️" sem mudar o que a pessoa vê.
const bare = (s: string) => s.replaceAll('️', '');

/**
 * O emoji que o modelo escolheu, ou `null`. Só vale a resposta que é exatamente um emoji da lista
 * (aceita aspas e pontuação em volta); "nenhuma", texto solto ou emoji de fora é não reagir.
 */
export function parseReaction(text: string, allowed: readonly string[]): string | null {
  const answer = bare(text.trim().replace(/^["'`“”‘’.,!:;\s]+|["'`“”‘’.,!:;\s]+$/gu, ''));
  return allowed.find((emoji) => bare(emoji) === answer) ?? null;
}
