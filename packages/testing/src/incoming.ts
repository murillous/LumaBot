// Monta a `Message` que o `bot.receive()` entrega, a partir de uma descrição curta: o teste diz
// só o que importa (`{ text: '!s', image }`) e o resto sai com padrões coerentes.

import type { Chat, Contact, Message } from '@zapforge/core';
import { createMessage, type MediaSource, type MessageInit } from '@zapforge/core/adapter';

/** Mídia de entrada: os bytes ou os bytes com o mimetype. */
export type IncomingMedia = Buffer | { readonly data: Buffer; readonly mimetype: string };

/** Anexo além da mídia principal (ADR 0065): os bytes ou os bytes com mimetype e nome. */
export type IncomingAttachment =
  | Buffer
  | { readonly data: Buffer; readonly mimetype: string; readonly fileName?: string };

/**
 * Mensagem que chega ao bot. Com uma mídia, `text` vira a legenda; sem mídia, é uma mensagem de
 * texto. No máximo uma mídia principal por mensagem; as outras vão em `attachments`.
 */
export interface IncomingMessage {
  readonly text?: string;
  readonly image?: IncomingMedia;
  readonly video?: IncomingMedia;
  readonly audio?: IncomingMedia;
  readonly voice?: IncomingMedia;
  readonly sticker?: IncomingMedia;
  readonly document?: IncomingMedia;
  /** Nome do arquivo de `document`. */
  readonly fileName?: string;
  /**
   * Anexos depois da mídia principal, na ordem, como os outros arquivos de uma mensagem do
   * Discord. Exige uma mídia principal, que dá o `type`. Sem mimetype, `application/octet-stream`.
   */
  readonly attachments?: readonly IncomingAttachment[];
  /** ID do chat (conversa privada) ou o chat completo. Padrão: `DEFAULT_CHAT`. */
  readonly chat?: string | Chat;
  /** Campos do remetente que diferem de `DEFAULT_SENDER`. */
  readonly sender?: Partial<Contact>;
  /** Mensagem citada, descrita do mesmo jeito ou já pronta. */
  readonly quoted?: IncomingMessage | Message;
  readonly mentions?: readonly Contact[];
  readonly fromMe?: boolean;
  readonly isForwarded?: boolean;
  readonly isViewOnce?: boolean;
  /** Padrão: um ID único. */
  readonly id?: string;
  /** Epoch em ms. Padrão: `Date.now()`. */
  readonly timestamp?: number;
}

export const DEFAULT_CHAT: Chat = { id: 'chat@fake', isGroup: false };

export const DEFAULT_SENDER: Contact = {
  id: 'user@fake',
  name: 'Usuário',
  phone: '5511900000000',
};

const MEDIA_TYPES = ['image', 'video', 'audio', 'voice', 'sticker', 'document'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

/** Mimetype quando o teste passa só os bytes: o formato que o WhatsApp usa para cada tipo. */
const DEFAULT_MIMETYPES: Record<MediaType, string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  voice: 'audio/ogg; codecs=opus',
  sticker: 'image/webp',
  document: 'application/octet-stream',
};

let nextId = 0;

export function buildMessage(input: IncomingMessage): Message {
  const mediaTypes = MEDIA_TYPES.filter((type) => input[type] !== undefined);
  if (mediaTypes.length > 1) {
    throw new TypeError(`receive(): uma mídia por mensagem, recebeu ${mediaTypes.join(' e ')}`);
  }
  nextId++;
  const base = {
    id: input.id ?? `in-${nextId}`,
    chat:
      typeof input.chat === 'string'
        ? { id: input.chat, isGroup: false }
        : (input.chat ?? DEFAULT_CHAT),
    sender: { ...DEFAULT_SENDER, ...input.sender },
    timestamp: input.timestamp ?? Date.now(),
    fromMe: input.fromMe ?? false,
    quoted: input.quoted === undefined ? null : toMessage(input.quoted),
    mentions: input.mentions ?? [],
    isForwarded: input.isForwarded ?? false,
    isViewOnce: input.isViewOnce ?? false,
  };

  const type = mediaTypes[0];
  if (type === undefined) {
    if (input.text === undefined) throw new TypeError('receive(): informe `text` ou uma mídia');
    if (input.attachments !== undefined && input.attachments.length > 0) {
      throw new TypeError('receive(): `attachments` exige uma mídia principal (`image`, ...)');
    }
    return createMessage({ ...base, type: 'text', text: input.text });
  }
  const media = mediaSource(input[type] as IncomingMedia, DEFAULT_MIMETYPES[type]);
  const text = input.text ?? null;
  const extra =
    input.attachments === undefined
      ? {}
      : {
          attachments: [
            media,
            ...input.attachments.map((a) => mediaSource(a, 'application/octet-stream')),
          ],
        };
  const init: MessageInit =
    type === 'document'
      ? { ...base, type, text, media, ...extra, fileName: input.fileName ?? null }
      : { ...base, type, text, media, ...extra };
  return createMessage(init);
}

function toMessage(input: IncomingMessage | Message): Message {
  // `is` só existe na mensagem pronta (`createMessage` o liga); a descrição nunca o tem.
  return 'is' in input ? input : buildMessage(input);
}

function mediaSource(media: IncomingAttachment, defaultMimetype: string): MediaSource {
  const { data, mimetype, fileName } = Buffer.isBuffer(media)
    ? { data: media, mimetype: defaultMimetype, fileName: undefined }
    : media;
  return {
    mimetype,
    size: data.length,
    ...(fileName === undefined ? null : { fileName }),
    download: async () => data,
  };
}
