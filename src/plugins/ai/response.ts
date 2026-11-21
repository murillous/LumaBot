// Pós-processamento da resposta do modelo para o chat: tira o que não é fala e divide em balões.

const THINK = /<think>[\s\S]*?<\/think>/gi;
const SPEAKER_PREFIX = /^Luma:\s*/i;
// Modelo em loop repete o mesmo caractere centenas de vezes; 30 já mostram o defeito.
const RUNAWAY = /(.)\1{29,}/gu;
// O WhatsApp não lê markdown: `[texto](url)` chega com o `)` colado na URL, e o link não abre.
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * Tira o raciocínio visível, o rótulo "Luma:" e a repetição desenfreada de um caractere, e solta
 * os links em markdown.
 */
export function cleanResponse(text: string): string {
  return text
    .trim()
    .replace(THINK, '')
    .replace(SPEAKER_PREFIX, '')
    .replace(RUNAWAY, (_, char: string) => char.repeat(30))
    .replace(MARKDOWN_LINK, (_, label: string, url: string) =>
      label.trim() === url ? url : `${label.trim()}: ${url}`,
    )
    .trim();
}

const BREAKS = ['. ', '! ', '? ', '\n', '; '];
/** Só corta num ponto natural se ele estiver além desta fração do limite, senão o balão fica minúsculo. */
const MIN_CUT = 0.4;
const URL = /https?:\/\/\S+/g;

/**
 * Ajusta o corte para não cair dentro de um link: o link cortado não abre. Ele vai inteiro para o
 * balão seguinte ou, se começa o balão, inteiro neste, mesmo passando do limite.
 */
function outsideUrl(text: string, cut: number): number {
  for (const m of text.matchAll(URL)) {
    const end = m.index + m[0].length;
    if (m.index < cut && cut < end) return m.index > 0 ? m.index : end;
  }
  return cut;
}

export interface SplitOptions {
  /** Tamanho máximo de cada balão. */
  readonly maxLength: number;
  /**
   * Teto de balões: trava contra modelo em loop inundando o chat, não o estilo da resposta. Nada é
   * descartado; o que passa do teto vai junto no último balão.
   */
  readonly maxParts: number;
}

/**
 * Divide a resposta em balões. O modelo separa com `[PARTE]`; sem o marcador, o texto longo é
 * cortado em pontuação ou quebra de linha perto do limite, nunca no meio de um link. Acima de
 * `maxParts`, o excedente se junta ao último balão em vez de sumir.
 */
export function splitIntoParts(text: string, { maxLength, maxParts }: SplitOptions): string[] {
  if (!text) return [];

  const marked = text
    .split('[PARTE]')
    .map((part) => part.trim())
    .filter(Boolean);
  if (marked.length > maxParts) {
    return [...marked.slice(0, maxParts - 1), marked.slice(maxParts - 1).join('\n\n')];
  }
  if (marked.length > 1) return marked;
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0 && parts.length < maxParts) {
    // No último balão permitido o resto vai inteiro: cortar mais seria perder texto.
    if (rest.length <= maxLength || parts.length === maxParts - 1) {
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
    cut = outsideUrl(rest, cut);
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts.filter(Boolean);
}
