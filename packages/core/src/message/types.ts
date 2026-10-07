// Contrato do modelo de mensagem normalizado (ADR 0009). Transports mapeiam o formato nativo
// para estes tipos; plugins nunca veem o objeto do transport (exceto via escape hatch).

/** Discriminante da union `Message`. `voice` (PTT) é separado de `audio`. */
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'sticker'
  | 'document'
  | 'location'
  | 'contact'
  | 'poll'
  | 'unknown';

/** Participante de uma conversa. `id` é o identificador nativo do transport (ex.: JID). */
export interface Contact {
  readonly id: string;
  readonly name: string | null;
  /**
   * Telefone só com dígitos, com DDI (`'5511999999999'`), ou `null` se o transport não souber.
   * Fica separado de `id` porque o ID nativo nem sempre carrega o número (no WhatsApp, um LID);
   * só o transport sabe resolvê-lo. É com ele que o roteador reconhece os `owners`.
   */
  readonly phone: string | null;
}

export interface Chat {
  readonly id: string;
  readonly isGroup: boolean;
}

/** Mídia anexada. `download()`/`stream()` são lazy; o download é cacheado por mensagem. */
export interface Media {
  readonly mimetype: string;
  /** Tamanho em bytes, quando o transport informa. */
  readonly size: number | null;
  download(): Promise<Buffer>;
  stream(): Promise<ReadableStream<Uint8Array>>;
}

interface BaseMessage<T extends MessageType> {
  readonly type: T;
  readonly id: string;
  readonly chat: Chat;
  readonly sender: Contact;
  /** Texto ou legenda; `null` se não houver. */
  readonly text: string | null;
  /** Epoch em milissegundos. */
  readonly timestamp: number;
  /** Mensagem enviada pela própria sessão do bot. */
  readonly fromMe: boolean;
  readonly quoted: Message | null;
  readonly mentions: readonly Contact[];
  readonly isForwarded: boolean;
  readonly isViewOnce: boolean;
  readonly isEdited: boolean;
  is<K extends MessageType>(type: K): this is MessageOf<K>;
}

interface MediaMessage<T extends MessageType> extends BaseMessage<T> {
  readonly media: Media;
}

export interface TextMessage extends BaseMessage<'text'> {
  readonly text: string;
}
export interface ImageMessage extends MediaMessage<'image'> {}
export interface VideoMessage extends MediaMessage<'video'> {}
export interface AudioMessage extends MediaMessage<'audio'> {}
export interface VoiceMessage extends MediaMessage<'voice'> {}
export interface StickerMessage extends MediaMessage<'sticker'> {}
export interface DocumentMessage extends MediaMessage<'document'> {
  readonly fileName: string | null;
}
export interface LocationMessage extends BaseMessage<'location'> {
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
    readonly name: string | null;
  };
}
export interface ContactMessage extends BaseMessage<'contact'> {
  readonly contacts: readonly { readonly name: string; readonly vcard: string }[];
}
export interface PollMessage extends BaseMessage<'poll'> {
  readonly poll: { readonly name: string; readonly options: readonly string[] };
}
export interface UnknownMessage extends BaseMessage<'unknown'> {}

export type Message =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | VoiceMessage
  | StickerMessage
  | DocumentMessage
  | LocationMessage
  | ContactMessage
  | PollMessage
  | UnknownMessage;

/** Membro da union com o `type` dado. */
export type MessageOf<K extends MessageType> = Extract<Message, { readonly type: K }>;

/** Tipos que carregam `media`. */
export type MediaMessageType = Extract<Message, { readonly media: Media }>['type'];
