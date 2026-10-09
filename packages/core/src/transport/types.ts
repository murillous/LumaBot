// Contrato do transport (ADR 0003). O core só conhece esta interface; cada adapter
// (`@zapforge/transport-baileys` etc.) traduz o formato nativo para os tipos daqui, então os
// eventos chegam ao kernel já normalizados.

import type { CommandInfo } from '#commands/command.ts';
import type { Logger } from '#logger/types.ts';
import type { Chat, Contact, Message } from '#message/types.ts';
import type { AuthStateStore } from '#storage/types.ts';
import type { FormattedText, MessageText } from '#text/format.ts';
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
  /**
   * Credenciais rejeitadas ou corrompidas. Com a capability `pairing`, o bot limpa a sessão e
   * pareia de novo; sem ela (token), limpar não traz credencial nova, e o bot para (ADR 0068).
   */
  | 'auth-failed'
  /**
   * Erro de configuração que reconectar não resolve: token sem permissão, intents não
   * permitidas, porta ocupada. O bot para, sem limpar a sessão (ADR 0068).
   */
  | 'fatal'
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
      /**
       * Uma lib que se reconecta sozinha (discord.js, grammY) só emite `closed` quando a queda é
       * terminal: o bot reconecta por cima de todo `closed` (ADR 0068).
       */
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
  /**
   * Clique num botão enviado com `SendOptions.actions` (capability `actions`, ADR 0062) ou
   * comando nativo da plataforma, como o slash command do Discord (ADR 0064). O transport
   * confirma a interação na plataforma antes de emitir; o kernel roda o comando ou o passo. Não
   * chega aos plugins como evento.
   */
  interaction: Interaction;
}

interface InteractionBase {
  /**
   * ID da interação, que vira o ID da mensagem do clique ou do comando. O `ctx.reply` cita essa
   * mensagem, e o transport decide como responder à interação (follow-up no Discord, por
   * exemplo).
   */
  readonly id: string;
  readonly chat: Chat;
  /** Quem clicou ou chamou o comando. */
  readonly sender: Contact;
  /** Epoch em milissegundos. */
  readonly timestamp: number;
}

/** Clique num botão (ADR 0062). */
export interface ActionInteraction extends InteractionBase {
  /** O `id` do `OutgoingAction` clicado, como o kernel o enviou. */
  readonly actionId: string;
  readonly command?: never;
}

/** Comando nativo da plataforma (ADR 0064): o slash command do Discord, por exemplo. */
export interface CommandInteraction extends InteractionBase {
  /** Nome ou alias do comando, sem prefixo. */
  readonly command: string;
  /**
   * Argumentos em texto livre, interpretados como o texto depois do comando digitado (aspas,
   * `rawArgs`). Vazio quando não há.
   */
  readonly args: string;
  readonly actionId?: never;
}

/** Interação que o transport entrega: o clique num botão ou o comando nativo. */
export type Interaction = ActionInteraction | CommandInteraction;

export type TransportEventName = keyof TransportEvents;

/** Handler pode ser assíncrono; quem emite trata a rejeição (ver `TypedEmitter`). */
export type TransportEventHandler<E extends TransportEventName> = (
  payload: TransportEvents[E],
) => void | Promise<void>;

/** Mídia a enviar: bytes em memória ou URL que o transport baixa. */
export type MediaInput = Buffer | { readonly url: string };

/**
 * Item de um álbum (ADR 0065). Sem legenda própria: a legenda é do álbum. O documento leva nome e
 * mimetype, como no envio avulso.
 */
export type AlbumItem =
  | { readonly type: 'image' | 'video'; readonly media: MediaInput; readonly mimetype?: string }
  | {
      readonly type: 'document';
      readonly media: MediaInput;
      readonly fileName: string;
      readonly mimetype: string;
    };

/**
 * Conteúdo a enviar. `text` e `caption` são o texto cru, que vai como veio. Com a árvore neutra
 * (ADR 0061), o core preenche `formatted`/`formattedCaption` e põe em `text`/`caption` o texto
 * visível dela: quem renderiza a árvore usa o campo novo, e quem não conhece envia o visível.
 */
export type OutgoingContent =
  | {
      readonly type: 'text';
      readonly text: string;
      readonly formatted?: FormattedText;
    }
  | {
      readonly type: 'image' | 'video';
      readonly media: MediaInput;
      readonly caption?: string;
      readonly formattedCaption?: FormattedText;
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
      readonly formattedCaption?: FormattedText;
    }
  | {
      /**
       * Várias mídias numa mensagem só (capability `send.album`, ADR 0065). O transport só o
       * recebe se declarar a capability, com no máximo `limits.album` itens e nunca menos de dois;
       * o que a plataforma não aceita junto (documento com foto, no Telegram) ele divide.
       */
      readonly type: 'album';
      readonly items: readonly AlbumItem[];
      readonly caption?: string;
      readonly formattedCaption?: FormattedText;
    }
  | {
      readonly type: 'poll';
      readonly name: string;
      readonly options: readonly string[];
      /** Quantas opções cada pessoa pode marcar; padrão 1. */
      readonly selectableCount?: number;
    };

/**
 * Limites de tamanho da plataforma (ADR 0061). A fila de saída divide o texto e a legenda acima
 * deles; o `edit` acima de `text` rejeita com `RangeError`.
 */
export interface TextLimits {
  /** Máximo de uma mensagem de texto. Ausente: sem limite. */
  readonly text?: number;
  /** Máximo de uma legenda de mídia. Ausente: sem limite. */
  readonly caption?: number;
  /**
   * Tamanho como a plataforma conta, quando ela conta a marcação (no Discord, `**` e `<@id>`
   * contam). Recebe a árvore, se houver, ou o texto cru. Padrão: o comprimento em UTF-16 do texto
   * visível (`plainText`), como conta o Telegram.
   */
  measure?(text: MessageText): number;
  /**
   * Máximo de botões numa mensagem (capability `actions`). Acima dele, o kernel envia o menu em
   * texto numerado (ADR 0062). Ausente: sem limite.
   */
  readonly actions?: number;
  /**
   * Máximo de itens num álbum (capability `send.album`). Acima dele, a fila divide em lotes
   * (ADR 0065). Ausente: sem limite.
   */
  readonly album?: number;
}

/**
 * Ritmo padrão da fila de saída para a plataforma (ADR 0067). A config do bot
 * (`createBot({ outbound })`) sobrescreve cada campo; o campo ausente cai no padrão do core.
 */
export interface TransportPacing {
  /** Intervalo mínimo entre dois envios quaisquer, em ms. */
  readonly globalIntervalMs?: number;
  /** Intervalo mínimo entre dois envios ao mesmo chat, em ms. */
  readonly chatIntervalMs?: number;
}

/**
 * Botão a renderizar (capability `actions`, ADR 0062). O `id` é opaco, com até 16 caracteres
 * ASCII (cabe no `callback_data` do Telegram), e volta no `actionId` do evento `interaction`.
 */
export interface OutgoingAction {
  readonly id: string;
  readonly label: string;
}

export interface SendOptions {
  /** Responde citando esta mensagem (capability `quoted`). */
  readonly quoted?: Message;
  /** IDs dos contatos mencionados (capability `mentions`). */
  readonly mentions?: readonly string[];
  /**
   * Botões abaixo da mensagem, na ordem (capability `actions`). Só vão com `type: 'text'`; num
   * texto dividido, só na última parte.
   */
  readonly actions?: readonly OutgoingAction[];
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
   * Objeto bruto de onde esta `Message` ou `Interaction` saiu (o `WAMessage` do Baileys, a
   * `Message` do discord.js, o `Update` do Telegram), para o `ctx.unsafe.raw()` (ADR 0066). Devolve
   * `undefined` para o que não saiu deste transport. Opcional: sem ele, o `raw()` devolve
   * `undefined`. Guarde o objeto num `WeakMap` da instância, chaveado pelo que foi emitido, e não
   * num campo da mensagem: some junto com ela e não aparece em spread nem em `JSON.stringify`.
   */
  raw?(source: Message | Interaction): unknown;
  /** Limites de tamanho de texto; fixos durante a vida da instância. Ausente: nada é dividido. */
  readonly limits?: TextLimits;
  /**
   * Ritmo padrão da fila de saída; fixo durante a vida da instância. Ausente: o padrão do core
   * (300 ms global, 1000 ms por chat), a política anti-ban do WhatsApp (ADR 0019).
   */
  readonly pacing?: TransportPacing;

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
  /**
   * Capability `message.edit`. Com a árvore neutra, `text` é o texto visível dela e `formatted`, a
   * árvore, como no `OutgoingContent`.
   */
  edit(key: MessageKey, text: string, formatted?: FormattedText): Promise<void>;
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
  /**
   * Comandos do bot, para o menu nativo da plataforma (slash commands do Discord, `setMyCommands`
   * do Telegram; ADR 0064). Opcional para quem monta o `TransportDeps` fora do `createBot`.
   */
  readonly commands?: TransportCommands;
}

/**
 * Lista de comandos que o transport registra na plataforma (ADR 0064). O menu mostra só o
 * `name`, e o `role` decide quem o vê (ver docs/transport.md).
 */
export interface TransportCommands {
  /** Os comandos registrados agora; um array novo a cada chamada. */
  list(): readonly CommandInfo[];
  /**
   * Avisa que a lista mudou: uma vez ao fim de cada reload e uma vez por tick para os comandos
   * adicionados fora dele. Não avisa no boot, que termina antes do `connect()`, nem a partir do
   * `stop()`. O aviso não traz a lista: chame `list()` e compare com o que já registrou antes de
   * chamar a plataforma. Erro do listener vai para o log do bot.
   */
  onChange(listener: () => void | Promise<void>): Unsubscribe;
}
