// Protocolo v1 do chat web (ADR 0077): frames JSON no WebSocket `GET <base>/chat`. Os tipos são
// o contrato com o front; o cliente de referência (`./client.ts`) os usa, e o servidor valida o
// que chega antes de confiar.

import type { FormattedText } from '@zapforge/core';

/** Fechamento: o primeiro frame não é um `auth` válido (ou chegou outro frame antes do `ready`). */
export const CLOSE_INVALID_AUTH = 4400;
/** Fechamento: token ausente, inválido ou vencido (inclusive no meio da conexão). */
export const CLOSE_UNAUTHORIZED = 4401;
/** Fechamento: o token é válido, mas falta o claim de tenant configurado. */
export const CLOSE_FORBIDDEN = 4403;
/** Fechamento: frame acima de `MAX_FRAME_BYTES`. */
export const CLOSE_TOO_BIG = 1009;
/** Fechamento: o transport desconectou (ou o bot parou). */
export const CLOSE_GOING_AWAY = 1001;

/** Teto de um frame. Mídia vai por HTTP, então o frame só leva texto e IDs. */
export const MAX_FRAME_BYTES: number = 64 * 1024;
/** Prazo para o primeiro frame (`auth`) depois de abrir a conexão. */
export const AUTH_TIMEOUT_MS = 10_000;
/** Conversa quando o `auth` não informa. */
export const DEFAULT_CONVERSATION = 'default';
/** Formato do ID de conversa: entra no `chat.id` sem escape. */
export const CONVERSATION_PATTERN: RegExp = /^[\w-]{1,64}$/;
/** Máximo de anexos numa mensagem do cliente. */
export const MAX_ATTACHMENTS = 10;

// --- Cliente → servidor ---

/** Primeiro frame da conexão. O token não volta em frame nenhum nem fica guardado. */
export interface AuthFrame {
  readonly type: 'auth';
  readonly token: string;
  /** Conversa do usuário (`[A-Za-z0-9_-]`, até 64). Padrão: `default`. */
  readonly conversation?: string;
}

/** Mensagem do usuário. Precisa de `text` ou de `attachments`. */
export interface ClientMessageFrame {
  readonly type: 'message';
  /** ID do lado do cliente, devolvido no `ack` para casar com o ID do servidor. */
  readonly ref?: string;
  readonly text?: string;
  /** IDs devolvidos pelo `POST <base>/media`, na ordem. */
  readonly attachments?: readonly string[];
}

/** Clique num botão: o `id` da ação, como veio em `actions`. */
export interface ActionFrame {
  readonly type: 'action';
  readonly actionId: string;
}

export type ClientFrame = AuthFrame | ClientMessageFrame | ActionFrame;

// --- Servidor → cliente ---

/** Autenticado; o que estava esperando no buffer vem logo depois. */
export interface ReadyFrame {
  readonly type: 'ready';
  readonly chatId: string;
  readonly userId: string;
}

/** Confirma uma mensagem do usuário com o ID que o servidor deu a ela. */
export interface AckFrame {
  readonly type: 'ack';
  readonly ref: string | null;
  readonly id: string;
}

/** Mídia de uma mensagem do bot. `url` relativa é sob a origem do servidor. */
export interface MediaRef {
  readonly url: string;
  readonly mimetype?: string;
  readonly fileName?: string;
}

/** Mensagem do bot. */
export interface ServerMessageFrame {
  readonly type: 'message';
  readonly id: string;
  /** Epoch em milissegundos. */
  readonly timestamp: number;
  readonly kind: 'text' | 'image' | 'video' | 'audio' | 'document';
  /** Texto, ou legenda da mídia (o texto visível, quando há `formatted`). */
  readonly text?: string;
  /** Árvore do texto formatado (ADR 0061), para o front renderizar. */
  readonly formatted?: FormattedText;
  readonly media?: MediaRef;
  /** ID da mensagem citada. */
  readonly quotedId?: string;
  readonly actions?: readonly { readonly id: string; readonly label: string }[];
}

export interface EditFrame {
  readonly type: 'edit';
  readonly id: string;
  readonly text: string;
  readonly formatted?: FormattedText;
}

export interface DeleteFrame {
  readonly type: 'delete';
  readonly id: string;
}

/** "Digitando" (some no próximo frame `message` ou depois de alguns segundos, a critério do front). */
export interface TypingFrame {
  readonly type: 'typing';
  readonly kind: 'text' | 'voice';
}

/** Frame recusado; a conexão segue aberta. */
export interface ErrorFrame {
  readonly type: 'error';
  readonly code: 'invalid-frame' | 'media-not-found';
  readonly message: string;
  /** O `ref` da mensagem recusada, quando houver. */
  readonly ref?: string;
}

export type ServerFrame =
  | ReadyFrame
  | AckFrame
  | ServerMessageFrame
  | EditFrame
  | DeleteFrame
  | TypingFrame
  | ErrorFrame;
