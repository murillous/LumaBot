// Contrato da fila de saída (M1-12, ADR 0019). O M1-12 completa este arquivo; os nomes
// exportados aqui são usados por outros módulos e não mudam.

import type { MessageText } from '#text/format.ts';
import type {
  MediaInput,
  MessageKey,
  OutgoingContent,
  Presence,
  SendOptions,
} from '#transport/types.ts';

/** Prioridade na fila: comandos respondem antes de broadcasts. */
export type SendPriority = 'high' | 'normal' | 'low';

export interface OutboundSendOptions extends SendOptions {
  /** Padrão: `'normal'`. */
  readonly priority?: SendPriority;
}

/** Envio exposto ao plugin (`ctx.send`); passa sempre pela fila de saída. */
export interface Sender {
  /**
   * Envia o conteúdo ou, como atalho, só o texto (cru ou formatado, ADR 0061). Um texto acima do
   * limite do transport sai em partes, e a chave devolvida é a da primeira.
   */
  send(
    chatId: string,
    content: OutgoingContent | MessageText,
    options?: OutboundSendOptions,
  ): Promise<MessageKey>;
}

/** Opções das ações da fila que não são envio (ADR 0040). */
export interface ActionOptions {
  /** Padrão: `'normal'`. */
  readonly priority?: SendPriority;
}

/**
 * `ctx.send`: tudo o que gera tráfego sobre mensagens e chats, sempre pela fila de saída (ADR
 * 0019, ADR 0040). Cada ação confere a capability antes de enfileirar e, sem ela, rejeita com
 * `UnsupportedError`.
 */
export interface Outbound extends Sender {
  /** Reage à mensagem; `emoji: null` remove a reação (capability `reactions`). */
  react(key: MessageKey, emoji: string | null, options?: ActionOptions): Promise<void>;
  /**
   * Troca o texto da mensagem (capability `message.edit`). Não se divide: acima do limite do
   * transport, rejeita com `RangeError`.
   */
  edit(key: MessageKey, text: MessageText, options?: ActionOptions): Promise<void>;
  /** Apaga a mensagem para todos (capability `message.delete`). */
  delete(key: MessageKey, options?: ActionOptions): Promise<void>;
  /** "Digitando", "gravando" etc. no chat (capability `presence`). */
  presence(chatId: string, presence: Presence, options?: ActionOptions): Promise<void>;
}

/** Opções de `ctx.reply`. A citação da mensagem original é automática. */
export interface ReplyOptions {
  /** IDs dos contatos mencionados (capability `mentions`). */
  readonly mentions?: readonly string[];
  /** Padrão: `'high'` — resposta a comando passa à frente de broadcasts. */
  readonly priority?: SendPriority;
}

export interface ReplyMediaOptions extends ReplyOptions {
  readonly caption?: MessageText;
  readonly mimetype?: string;
}

export interface ReplyAudioOptions extends ReplyOptions {
  readonly mimetype?: string;
}

export interface ReplyDocumentOptions extends ReplyOptions {
  readonly fileName: string;
  readonly mimetype: string;
  readonly caption?: MessageText;
}

export interface ReplyPollOptions extends ReplyOptions {
  /** Quantas opções cada pessoa pode marcar; padrão 1. */
  readonly selectableCount?: number;
}

/**
 * `ctx.reply`: responde no chat da mensagem, citando-a, pela fila de saída. Chamado direto
 * envia texto, cru ou formatado (ADR 0061); os atalhos cobrem cada tipo de `OutgoingContent`.
 */
export interface Reply {
  (text: MessageText, options?: ReplyOptions): Promise<MessageKey>;
  text(text: MessageText, options?: ReplyOptions): Promise<MessageKey>;
  image(media: MediaInput, options?: ReplyMediaOptions): Promise<MessageKey>;
  video(media: MediaInput, options?: ReplyMediaOptions): Promise<MessageKey>;
  audio(media: MediaInput, options?: ReplyAudioOptions): Promise<MessageKey>;
  /** Mensagem de voz (PTT). */
  voice(media: MediaInput, options?: ReplyAudioOptions): Promise<MessageKey>;
  sticker(media: MediaInput, options?: ReplyOptions): Promise<MessageKey>;
  document(media: MediaInput, options: ReplyDocumentOptions): Promise<MessageKey>;
  poll(name: string, choices: readonly string[], options?: ReplyPollOptions): Promise<MessageKey>;
}
