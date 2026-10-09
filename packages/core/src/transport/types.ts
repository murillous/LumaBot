// Contrato do transport (ADR 0003). O core só conhece esta interface; cada adapter
// (`@zapforge/transport-baileys` etc.) traduz o formato nativo para os tipos daqui, então os
// eventos chegam ao kernel já normalizados.

import type { Logger } from '#logger/types.ts';
import type { Chat, Contact, Message } from '#message/types.ts';
import type { AuthStateStore } from '#storage/types.ts';
import type { Capability } from './capabilities.ts';

/** Cancela a assinatura feita com `on()`. Chamar mais de uma vez é inofensivo. */
export type Unsubscribe = () => void;

/**
 * Motivo de desconexão normalizado. O adapter mapeia o código nativo (ex.: status code do
 * Baileys) para um destes; a `ReconnectionPolicy` decide em cima dele.
 */
export type DisconnectReason =
  /** O QR expirou sem ser escaneado. */
  | 'qr-timeout'
  /** A sessão foi encerrada no aparelho; as credenciais não valem mais. */
  | 'logged-out'
  /** Credenciais rejeitadas ou corrompidas. */
  | 'auth-failed'
  /** Outra conexão da mesma sessão assumiu (ex.: outro processo com o mesmo número). */
  | 'replaced'
  /** Falha do lado do servidor do serviço de mensagens. */
  | 'server-error'
  /** Queda de rede, timeout ou fechamento inesperado. */
  | 'connection-lost'
  | 'unknown';

export type ConnectionStatus =
  | { readonly status: 'connecting' }
  | { readonly status: 'open' }
  | {
      readonly status: 'closed';
      readonly reason: DisconnectReason;
      /** Erro nativo, para log; o kernel não interpreta. */
      readonly error: unknown;
    };

/** Referência para agir sobre uma mensagem já existente (reagir, editar, apagar). */
export interface MessageKey {
  readonly chatId: string;
  readonly id: string;
  readonly fromMe: boolean;
  /** Autor em grupos; alguns transports precisam dele para localizar a mensagem. */
  readonly senderId: string | null;
}

/**
 * Alteração de participantes. Cada ação tem a sua capability (`groupActionCapability`): fora do
 * WhatsApp, bot não adiciona ninguém (ADR 0059). `remove` tira a pessoa sem impedir que volte.
 */
export type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote';

export interface GroupParticipant extends Contact {
  /** Verdadeiro também para o dono do grupo (`isSuperAdmin`). */
  readonly isAdmin: boolean;
  /** Dono ou criador do grupo (no Discord, o dono do servidor). */
  readonly isSuperAdmin: boolean;
}

export interface GroupMetadata {
  readonly id: string;
  /** Nome do grupo, como o `Chat.title`. */
  readonly title: string;
  readonly description: string | null;
  readonly ownerId: string | null;
  /**
   * Todos os participantes. Ausente quando a plataforma não lista membros (Telegram) ou listar
   * custa caro (servidor grande do Discord); nunca vem pela metade (ADR 0059).
   */
  readonly participants?: readonly GroupParticipant[];
}

/**
 * Eventos que o transport entrega ao kernel (plano §6.4). `message:<type>` e `plugin.error`
 * não estão aqui: o kernel os deriva/gera.
 */
export interface TransportEvents {
  message: Message;
  /** Nova versão da mensagem, com `isEdited: true`. */
  'message.edited': Message;
  'message.deleted': {
    readonly chat: Chat;
    readonly messageId: string;
    readonly deletedBy: Contact | null;
    /** Apagada pela própria sessão; o `ignoreSelf` a barra (ADR 0038). */
    readonly fromMe: boolean;
  };
  reaction: {
    readonly chat: Chat;
    readonly messageId: string;
    readonly sender: Contact;
    /** `null` quando a reação foi removida. */
    readonly emoji: string | null;
    /** Reação da própria sessão; o `ignoreSelf` a barra (ADR 0038). */
    readonly fromMe: boolean;
  };
  /**
   * O bot entrou num grupo. Onde se entra num espaço e não num chat (servidor do Discord), o
   * `chat` é o espaço: o mesmo ID que os canais dele trazem em `parentId` (ADR 0059).
   */
  'group.joined': { readonly chat: Chat };
  /** O bot saiu ou foi removido de um grupo (ou de um espaço, como no `group.joined`). */
  'group.left': { readonly chat: Chat };
  'group.participants': {
    readonly chat: Chat;
    readonly action: GroupParticipantAction;
    readonly participants: readonly Contact[];
    readonly actor: Contact | null;
  };
  /** Só os campos alterados vêm preenchidos. */
  'group.updated': {
    readonly chat: Chat;
    readonly title?: string;
    readonly description?: string | null;
    /** Só admins enviam mensagens (onde a plataforma tem essa configuração). */
    readonly announce?: boolean;
    /** Só admins editam os dados do grupo (onde a plataforma tem essa configuração). */
    readonly restrict?: boolean;
  };
  /**
   * Nome ou telefone de um contato mudou (ex.: `pushName` novo). Só os campos alterados vêm
   * preenchidos (ADR 0040).
   */
  'contact.updated': {
    readonly id: string;
    readonly name?: string | null;
    readonly phone?: string | null;
  };
  'connection.status': ConnectionStatus;
  /** QR a apresentar para parear; o kernel decide como mostrar. */
  'connection.qr': { readonly qr: string };
  /**
   * Código de pareamento a digitar no aparelho, a alternativa ao QR (no WhatsApp, "conectar com
   * número de telefone"). Conta como um QR para o limite de QRs da reconexão (ADR 0050).
   */
  'connection.pairing-code': { readonly code: string };
}

export type TransportEventName = keyof TransportEvents;

/** Handler pode ser assíncrono; quem emite trata a rejeição (ver `TypedEmitter`). */
export type TransportEventHandler<E extends TransportEventName> = (
  payload: TransportEvents[E],
) => void | Promise<void>;

/** Mídia a enviar: bytes em memória ou URL que o transport baixa. */
export type MediaInput = Buffer | { readonly url: string };

export type OutgoingContent =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image' | 'video';
      readonly media: MediaInput;
      readonly caption?: string;
      readonly mimetype?: string;
    }
  | { readonly type: 'audio' | 'voice'; readonly media: MediaInput; readonly mimetype?: string }
  | { readonly type: 'sticker'; readonly media: MediaInput }
  | {
      readonly type: 'document';
      readonly media: MediaInput;
      readonly fileName: string;
      readonly mimetype: string;
      readonly caption?: string;
    }
  | {
      readonly type: 'poll';
      readonly name: string;
      readonly options: readonly string[];
      /** Quantas opções cada pessoa pode marcar; padrão 1. */
      readonly selectableCount?: number;
    };

export interface SendOptions {
  /** Responde citando esta mensagem (capability `quoted`). */
  readonly quoted?: Message;
  /** IDs dos contatos mencionados (capability `mentions`). */
  readonly mentions?: readonly string[];
}

export type Presence = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';

/**
 * Adapter de um canal de mensageria. Métodos ligados a uma capability que o transport não
 * declara devem lançar `UnsupportedError`; o kernel checa antes de chamar, então isso só
 * dispara se alguém pular a checagem.
 */
export interface Transport {
  /** Identificador do adapter (ex.: `baileys`). */
  readonly name: string;
  /** O que este transport suporta; fixo durante a vida da instância. */
  readonly capabilities: ReadonlySet<Capability>;
  /** Contato da própria sessão; `null` até a primeira conexão aberta. */
  readonly self: Contact | null;
  /** Objeto nativo (ex.: socket do Baileys) para o escape hatch `ctx.unsafe.native` (ADR 0011). */
  readonly native: unknown;

  /**
   * Inicia uma tentativa de conexão e resolve assim que ela começou (socket criado), sem esperar o
   * `open`. Rejeita só se nem deu para começar. Daí em diante, o andamento e as falhas chegam por
   * `connection.status`: o transport emite `open` quando dá para enviar e `closed` se a tentativa
   * cair, mesmo antes de o `connect()` resolver (ADR 0048).
   */
  connect(): Promise<void>;
  /**
   * Encerra a conexão. Deve ser seguro e idempotente: resolver sem lançar quando chamado sem
   * `connect()`, depois de um `connect()` que falhou ou que ainda não terminou, ou mais de uma
   * vez, porque o shutdown do `Bot` chama `disconnect()` em qualquer desses estados.
   */
  disconnect(): Promise<void>;

  /** Assina um evento. Sem estado global: as assinaturas vivem na instância do transport. */
  on<E extends TransportEventName>(event: E, handler: TransportEventHandler<E>): Unsubscribe;

  /** Envia e devolve a chave da mensagem criada, para editar/apagar/reagir depois. */
  send(chatId: string, content: OutgoingContent, options?: SendOptions): Promise<MessageKey>;
  /** `emoji: null` remove a reação (capability `reactions`). */
  react(key: MessageKey, emoji: string | null): Promise<void>;
  /** Capability `message.edit`. */
  edit(key: MessageKey, text: string): Promise<void>;
  /** Apaga para todos (capability `message.delete`). */
  delete(key: MessageKey): Promise<void>;
  /** Capability `presence`. */
  sendPresence(chatId: string, presence: Presence): Promise<void>;

  /** Capability `groups`. */
  getGroupMetadata(groupId: string): Promise<GroupMetadata>;
  /**
   * Se o contato é admin do chat, do jeito da plataforma (no Discord, permissão no servidor e no
   * canal; no Telegram, `getChatMember`). Opcional: sem ele, o papel `group-admin` procura o
   * contato nos `participants` do `getGroupMetadata` (ADR 0059).
   */
  isChatAdmin?(chat: Chat, contact: Contact): Promise<boolean>;
  /**
   * Capability da ação (`groups.add`, `groups.remove` ou `groups.promote`); o bot precisa ser
   * admin do grupo.
   */
  updateGroupParticipants(
    groupId: string,
    participantIds: readonly string[],
    action: GroupParticipantAction,
  ): Promise<void>;
}

/**
 * O que o bot entrega à fábrica do transport (ADR 0037). Campos novos só entram por adição, para
 * não quebrar adapters existentes.
 */
export interface TransportDeps {
  /** Sessão do bot (ADR 0036). */
  readonly session: string;
  /** Auth state da sessão no storage do bot (`storage.authState(session)`). */
  readonly auth: AuthStateStore;
  /**
   * Logger do bot com `{ transport: name }`, com a censura de segredos do bot. Antes do
   * `start()` descarta as linhas: o logger real só nasce lá.
   */
  readonly log: Logger;
}
