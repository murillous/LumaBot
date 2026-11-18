// Pós-processamento da resposta do modelo para o chat: tira o que não é fala e divide em balões.

const THINK = /<think>[\s\S]*?<\/think>/gi;
const SPEAKER_PREFIX = /^Luma:\s*/i;
// Modelo em loop repete o mesmo caractere centenas de vezes; 30 já mostram o defeito.
const RUNAWAY = /(.)\1{29,}/gu;

/** Tira o raciocínio visível, o rótulo "Luma:" e a repetição desenfreada de um caractere. */
export function cleanResponse(text: string): string {
  return text
    .trim()
    .replace(THINK, '')
    .replace(SPEAKER_PREFIX, '')
    .replace(RUNAWAY, (_, char: string) => char.repeat(30))
    .trim();
}

const BREAKS = ['. ', '! ', '? ', '\n', '; '];
/** Só corta num ponto natural se ele estiver além desta fração do limite, senão o balão fica minúsculo. */
const MIN_CUT = 0.4;

export interface SplitOptions {
  /** Tamanho máximo de cada balão. */
  readonly maxLength: number;
  /** Balões no máximo; o que passar disso é descartado. */
  readonly maxParts: number;
}

/**
 * Divide a resposta em balões. O modelo separa com `[PARTE]`; sem o marcador, o texto longo é
 * cortado em pontuação ou quebra de linha perto do limite.
 */
export function splitIntoParts(text: string, { maxLength, maxParts }: SplitOptions): string[] {
  if (!text) return [];

  const marked = text
    .split('[PARTE]')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, maxParts);
  if (marked.length > 1) return marked;
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0 && parts.length < maxParts) {
    if (rest.length <= maxLength) {
      parts.push(rest);
      break;
    }
    let cut = maxLength;
    for (const sep of BREAKS) {
      const at = rest.lastIndexOf(sep, maxLength);
      if (at > maxLength * MIN_CUT) {
        cut = at + sep.length;
        break;
      }
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts.filter(Boolean);
}
