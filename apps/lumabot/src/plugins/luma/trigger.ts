// Quando a mensagem chama a Luma pelo nome. Puro: o plugin só passa os `names` da config.

const escapeRegex = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Borda de palavra que entende acento: `\b` do JS só conhece ASCII.
const BEFORE = '(?<![\\p{L}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{N}_])';

function alternatives(names: readonly string[]): string {
  return names.map(escapeRegex).join('|');
}

/** O nome aparece como palavra em qualquer ponto do texto ("a luma sabe?" chama; "lumaluma" não). */
export function isTriggered(text: string | null | undefined, names: readonly string[]): boolean {
  if (!text) return false;
  return new RegExp(`${BEFORE}(?:${alternatives(names)})${AFTER}`, 'iu').test(text);
}

/**
 * Tira a chamada do começo ("Ei Luma, ", "fala luma "), deixando o que a pessoa quer. Se o nome
 * está no meio da frase, o texto fica inteiro: ele faz parte do que foi dito.
 */
export function stripTrigger(text: string, names: readonly string[]): string {
  const lead = new RegExp(
    `^\\s*(?:(?:ei|oi|e\\s+aí|fala)\\s+)?(?:${alternatives(names)})${AFTER}[,!?:]?\\s*`,
    'iu',
  );
  return text.replace(lead, '').trim();
}
