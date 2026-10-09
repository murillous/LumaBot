// Álbum do envio (ADR 0065): com a capability `send.album`, vai em lotes de até `limits.album`
// itens; sem ela, item a item. Roda antes da divisão da legenda (ADR 0061), na entrada da fila.

import type { OutgoingContent, SendOptions, Transport } from '#transport/types.ts';
import { positiveLimit, type SendPart } from './text.ts';

type AlbumContent = Extract<OutgoingContent, { readonly type: 'album' }>;

/** A capability e o limite do transport, lidos uma vez: são fixos na vida da instância. */
export class AlbumSplitter {
  /** Itens por mensagem: `limits.album` com a capability, um sem ela. */
  readonly #size: number;

  constructor(transport: Pick<Transport, 'capabilities' | 'limits'>) {
    const max = positiveLimit('album', transport.limits?.album);
    this.#size = transport.capabilities.has('send.album') ? max : 1;
  }

  /**
   * As mensagens do álbum, na ordem, com a legenda na primeira. Um lote de um item sai como
   * mensagem comum, porque o Telegram não aceita álbum de um. As opções seguem a regra das partes
   * do texto: só a primeira cita, só a última leva os botões, as menções vão em todas. Lança
   * `TypeError` com o álbum vazio.
   */
  split(content: AlbumContent, options: SendOptions | undefined): SendPart[] {
    const { items } = content;
    if (items.length === 0) throw new TypeError('álbum sem itens');
    const contents: OutgoingContent[] = [];
    for (let start = 0; start < items.length; start += this.#size) {
      const lot = items.slice(start, start + this.#size);
      const caption = start === 0 ? captionOf(content) : {};
      contents.push(
        lot.length === 1
          ? ({ ...lot[0], ...caption } as OutgoingContent)
          : { type: 'album', items: lot, ...caption },
      );
    }
    return distribute(contents, options);
  }
}

/** Legenda do álbum, só com os campos definidos: o transport não recebe `undefined` explícito. */
function captionOf(content: AlbumContent): Pick<AlbumContent, 'caption' | 'formattedCaption'> {
  return {
    ...(content.caption === undefined ? null : { caption: content.caption }),
    ...(content.formattedCaption === undefined
      ? null
      : { formattedCaption: content.formattedCaption }),
  };
}

function distribute(contents: OutgoingContent[], options: SendOptions | undefined): SendPart[] {
  if (options === undefined || contents.length === 1) {
    return contents.map((content) => ({ content, options }));
  }
  const { quoted, actions, ...others } = options;
  const last = contents.length - 1;
  return contents.map((content, index) => ({
    content,
    options: {
      ...others,
      ...(index === 0 && quoted !== undefined ? { quoted } : null),
      ...(index === last && actions !== undefined ? { actions } : null),
    },
  }));
}
