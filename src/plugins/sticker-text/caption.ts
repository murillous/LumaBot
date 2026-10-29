// Legenda de meme na figurinha: texto com contorno, em cima ou embaixo. O texto sai pelo Pango
// (entrada `text` do Sharp) e não por SVG: o librsvg pinta o emoji com o `fill`, e ele saía
// como uma silhueta branca; o Pango com `rgba` desenha a fonte de emoji colorida.

import { resolve } from 'node:path';
import sharp from 'sharp';

/**
 * Fonte de emoji colorida versionada no repositório, para não depender da do sistema. Relativa ao
 * diretório de onde o processo roda, como o banco; se faltar, o emoji só sai sem cor.
 */
const EMOJI_FONT = resolve('fonts/NotoColorEmoji.ttf');
const SIZE = 512;
const MAX_CHARS = 90;
/** Folga até a borda da figurinha. */
const MARGIN = 16;
/** A legenda ocupa no máximo um terço da figurinha; texto maior encolhe para caber. */
const MAX_HEIGHT = Math.round(SIZE / 3);

export interface CaptionStyle {
  /** Família e estilo no formato do Pango (`Sans Bold`, `Impact`). */
  readonly font: string;
  /** Tamanho em px; o texto encolhe se passar de um terço da figurinha. */
  readonly fontSize: number;
  /** Cor do texto, `#rrggbb`. */
  readonly color: string;
  readonly strokeColor: string;
  /** Espessura do contorno em px; 0 tira o contorno. */
  readonly strokeWidth: number;
  readonly position: 'top' | 'bottom';
}

/** Escreve o texto no PNG 512×512; sem texto, devolve a imagem como veio. */
export async function addCaption(
  image: Buffer,
  text: string,
  style: CaptionStyle,
): Promise<Buffer> {
  const caption = text.slice(0, MAX_CHARS).trim();
  if (!caption) return image;
  const layer = await captionLayer(caption, style);
  const { width = 0, height = 0 } = await sharp(layer).metadata();
  return sharp(image)
    .composite([
      {
        input: layer,
        left: Math.round((SIZE - width) / 2),
        top: style.position === 'top' ? MARGIN : SIZE - MARGIN - height,
      },
    ])
    .png()
    .toBuffer();
}

/**
 * Se o Pango desenha emoji em cores: sem a `fonts/NotoColorEmoji.ttf` (processo fora da raiz) ou,
 * no Windows, sem o `FONTCONFIG_FILE`, o emoji sai na cor do texto.
 */
export async function rendersColorEmoji(): Promise<boolean> {
  const { channels } = await sharp({
    text: { text: '😀', rgba: true, dpi: 144, fontfile: EMOJI_FONT },
  }).stats();
  const [red, , blue] = channels;
  return Math.abs((red?.mean ?? 0) - (blue?.mean ?? 0)) > 1;
}

/** Texto com o contorno, recortado no tamanho do texto. */
async function captionLayer(text: string, style: CaptionStyle): Promise<Buffer> {
  const stroke = style.strokeWidth;
  const fill = await renderText(text, style, SIZE - 2 * (MARGIN + stroke));
  if (stroke === 0) return fill;

  // O Pango não tem contorno: a silhueta do texto em `strokeColor`, carimbada em volta a
  // `stroke` px em passos de ~2 px de arco, faz a borda; o texto vai por cima.
  const { width = 0, height = 0 } = await sharp(fill).metadata();
  const alpha = await sharp(fill).extractChannel('alpha').raw().toBuffer();
  const silhouette = await sharp({
    create: { width, height, channels: 3, background: style.strokeColor },
  })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  const steps = Math.max(8, Math.ceil(Math.PI * stroke));
  const stamps = Array.from({ length: steps }, (_, i) => {
    const angle = (2 * Math.PI * i) / steps;
    return {
      input: silhouette,
      left: Math.round(stroke + stroke * Math.cos(angle)),
      top: Math.round(stroke + stroke * Math.sin(angle)),
    };
  });
  return sharp({
    create: {
      width: width + 2 * stroke,
      height: height + 2 * stroke,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([...stamps, { input: fill, left: stroke, top: stroke }])
    .png()
    .toBuffer();
}

/** Texto centralizado e quebrado em `width`; se passar de `MAX_HEIGHT`, o Pango o encolhe. */
async function renderText(text: string, style: CaptionStyle, width: number): Promise<Buffer> {
  const options = {
    text: `<span foreground="${style.color}">${escapeMarkup(text)}</span>`,
    // Com o dpi padrão (72), ponto e pixel coincidem.
    font: `${style.font} ${style.fontSize}`,
    fontfile: EMOJI_FONT,
    width,
    align: 'centre',
    wrap: 'word-char',
    rgba: true,
  } as const;
  const fixed = await sharp({ text: options }).png().toBuffer();
  const { height = 0 } = await sharp(fixed).metadata();
  if (height <= MAX_HEIGHT) return fixed;
  return sharp({ text: { ...options, height: MAX_HEIGHT } })
    .png()
    .toBuffer();
}

/** O texto vai dentro de markup do Pango, que segue as regras do XML. */
function escapeMarkup(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
