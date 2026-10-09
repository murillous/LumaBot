// Texto do envio (ADR 0061): a árvore neutra vira o par `text` visível + `formatted`, e o texto
// acima do limite do transport vira várias partes, antes de entrar na fila de saída.

import { type FormattedText, isFormatted, type MessageText, plainText } from '#text/format.ts';
import { splitText } from '#text/split.ts';
import type { OutgoingContent, SendOptions, TextLimits, Transport } from '#transport/types.ts';

/** Uma parte do envio: o conteúdo e as opções com que vai ao transport. */
export interface SendPart {
  readonly content: OutgoingContent;
  readonly options: SendOptions | undefined;
}

/** Conteúdo de texto com o `text` visível e, para a árvore, o `formatted`. */
export function textContent(text: MessageText): OutgoingContent {
  return typeof text === 'string'
    ? { type: 'text', text }
    : { type: 'text', text: plainText(text), formatted: text };
}

/** Campos da legenda no conteúdo, ou nada, para não mandar `undefined` explícito ao transport. */
export function captionFields(caption: MessageText | undefined): {
  caption?: string;
  formattedCaption?: FormattedText;
} {
  if (caption === undefined) return {};
  return typeof caption === 'string'
    ? { caption }
    : { caption: plainText(caption), formattedCaption: caption };
}

/** O que o `send` aceita: o conteúdo ou, como atalho, só o texto. */
export function toContent(input: OutgoingContent | MessageText): OutgoingContent {
  if (typeof input === 'string' || isFormatted(input)) return textContent(input);
  // O texto visível sai sempre da árvore: o transport que não a conhece envia o mesmo texto.
  if (input.type === 'text' && input.formatted !== undefined) return textContent(input.formatted);
  if ('formattedCaption' in input && input.formattedCaption !== undefined) {
    return { ...input, caption: plainText(input.formattedCaption) };
  }
  return input;
}

function measureVisible(text: MessageText): number {
  return typeof text === 'string' ? text.length : plainText(text).length;
}

function positiveLimit(name: string, value: number | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (!(Number.isInteger(value) && value >= 1)) {
    throw new RangeError(`limits.${name} do transport deve ser inteiro >= 1 (recebido: ${value})`);
  }
  return value;
}

/** Os limites do transport, validados uma vez: são fixos na vida da instância. */
export class TextLimiter {
  readonly #text: number;
  readonly #caption: number;
  readonly #measure: (text: MessageText) => number;
  /** Sem limite nenhum, o envio passa direto, sem medir. */
  readonly #unlimited: boolean;

  constructor(transport: Pick<Transport, 'limits'>) {
    const limits: TextLimits = transport.limits ?? {};
    this.#text = positiveLimit('text', limits.text);
    this.#caption = positiveLimit('caption', limits.caption);
    const custom = limits.measure;
    this.#measure = custom === undefined ? measureVisible : (text) => custom.call(limits, text);
    this.#unlimited =
      this.#text === Number.POSITIVE_INFINITY && this.#caption === Number.POSITIVE_INFINITY;
  }

  /**
   * As partes do envio, na ordem. Só a primeira cita a mensagem, e só a última leva os botões; as
   * menções vão em todas. Uma legenda longa fica com o começo na mídia, e o resto vira texto.
   */
  split(content: OutgoingContent, options: SendOptions | undefined): SendPart[] {
    if (this.#unlimited) return [{ content, options }];
    let first: OutgoingContent;
    let rest: MessageText[];
    if (content.type === 'text') {
      const parts = this.#split(content.formatted ?? content.text, this.#text);
      if (parts.length <= 1) return [{ content, options }];
      first = textContent(parts[0] as MessageText);
      rest = parts.slice(1);
    } else if (
      (content.type === 'image' || content.type === 'video' || content.type === 'document') &&
      content.caption !== undefined
    ) {
      const parts = this.#split(content.formattedCaption ?? content.caption, this.#caption);
      if (parts.length <= 1) return [{ content, options }];
      const { caption: _caption, formattedCaption: _formatted, ...media } = content;
      first = { ...media, ...captionFields(parts[0]) };
      rest = parts.slice(1);
    } else {
      return [{ content, options }];
    }
    let firstOptions = options;
    let restOptions: SendOptions | undefined;
    let lastOptions: SendOptions | undefined;
    if (options !== undefined) {
      // Os botões vão onde a leitura termina, na última parte (ADR 0062).
      const { quoted: _quoted, actions, ...others } = options;
      restOptions = others;
      lastOptions = actions === undefined ? others : { ...others, actions };
      if (actions !== undefined) {
        const { actions: _actions, ...withoutActions } = options;
        firstOptions = withoutActions;
      }
    }
    const last = rest.length - 1;
    return [
      { content: first, options: firstOptions },
      ...rest.map((text, index) => ({
        content: textContent(text),
        options: index === last ? lastOptions : restOptions,
      })),
    ];
  }

  /** Afirma que o texto da edição cabe; a edição não se divide. */
  assertEditFits(text: MessageText): void {
    if (this.#text === Number.POSITIVE_INFINITY) return;
    const size = this.#measure(text);
    if (size > this.#text) {
      throw new RangeError(
        `texto da edição com ${size} caracteres passa do limite do transport (${this.#text})`,
      );
    }
  }

  #split(text: MessageText, limit: number): MessageText[] {
    if (limit === Number.POSITIVE_INFINITY) return [text];
    // A primeira parte de uma legenda segue o limite da legenda; as outras viram texto.
    const rest = Number.isFinite(this.#text) ? this.#text : limit;
    return splitText(text, { first: limit, rest }, this.#measure);
  }
}
