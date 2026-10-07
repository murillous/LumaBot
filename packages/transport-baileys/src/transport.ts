// Transport do WhatsApp sobre o Baileys (M2-1). Este módulo cuida da conexão: socket, QR ou
// código de pareamento, credenciais no storage do bot e o motivo de cada queda. Quem decide
// reconectar é o `Bot`, pela `ReconnectionPolicy` (ADR 0048). As mensagens recebidas passam
// pela normalização (`normalize.ts`) antes de virar o evento `message`.

import { Readable } from 'node:stream';
import {
  type Capability,
  type Contact,
  type GroupMetadata,
  type GroupParticipantAction,
  type Logger,
  type MessageKey,
  type OutgoingContent,
  type Presence,
  type SendOptions,
  type Unsubscribe,
  UnsupportedError,
} from '@zapforge/core';
import {
  capabilitiesForSend,
  type Transport,
  type TransportDeps,
  type TransportEventHandler,
  type TransportEventName,
  type TransportEvents,
  TypedEmitter,
} from '@zapforge/core/adapter';
import {
  type AuthenticationState,
  type Contact as BaileysContact,
  type BaileysEventMap,
  downloadMediaMessage,
  isJidStatusBroadcast,
  jidDecode,
  jidNormalizedUser,
  type WAMessage,
  type WAVersion,
} from 'baileys';
import { loadAuthState } from './auth-state.ts';
import { toDisconnectReason } from './disconnect-reason.ts';
import { type ILogger, toBaileysLogger } from './logger.ts';
import { type NormalizeEnv, toMessage } from './normalize.ts';

/** Como parear uma sessão sem credenciais: escaneando o QR ou digitando um código no aparelho. */
export type BaileysPairing = 'qr' | { readonly phone: string };

/** O que o transport usa do socket do Baileys; nos testes, um socket falso. */
export interface BaileysSocket {
  readonly ev: {
    on<E extends keyof BaileysEventMap>(
      event: E,
      listener: (arg: BaileysEventMap[E]) => void,
    ): void;
  };
  readonly user: BaileysContact | undefined;
  /** Mapeamento LID ↔ telefone que o Baileys aprende com a sessão. */
  readonly signalRepository: {
    readonly lidMapping: { getPNForLID(lid: string): Promise<string | null> };
  };
  end(error: Error | undefined): Promise<void>;
  requestPairingCode(phoneNumber: string): Promise<string>;
  /** Pede ao aparelho que reenvie uma mídia cujo link expirou. */
  updateMediaMessage(message: WAMessage): Promise<WAMessage>;
}

export interface SocketConfig {
  readonly auth: AuthenticationState;
  readonly logger: ILogger;
  readonly version: WAVersion;
}

/** Acesso ao Baileys que tem efeito fora do processo; os testes trocam pelos falsos. */
export interface BaileysDriver {
  makeSocket(config: SocketConfig): BaileysSocket;
  /** Versão do protocolo do WhatsApp Web a anunciar. */
  version(): Promise<WAVersion>;
}

export interface BaileysTransportOptions {
  readonly pairing: BaileysPairing;
  readonly driver: BaileysDriver;
}

export class BaileysTransport implements Transport {
  readonly name = 'baileys';
  // O envio e as demais ações vêm no M2-1.3/M2-1.4; até lá, todas lançam `UnsupportedError`.
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>();

  readonly #pairing: BaileysPairing;
  readonly #driver: BaileysDriver;
  readonly #deps: TransportDeps;
  readonly #events: TypedEmitter<TransportEvents>;
  #socket: BaileysSocket | null = null;
  #self: Contact | null = null;
  /** Sobe a cada `connect()`/`disconnect()`: invalida a tentativa que ainda estava começando. */
  #attempt = 0;

  constructor(options: BaileysTransportOptions, deps: TransportDeps) {
    this.#pairing = options.pairing;
    this.#driver = options.driver;
    this.#deps = deps;
    this.#events = new TypedEmitter<TransportEvents>((error, event) =>
      this.#log.error('handler de evento do transport falhou', { err: error, event }),
    );
  }

  get self(): Contact | null {
    return this.#self;
  }

  /** O socket do Baileys (`WASocket`) da tentativa atual, ou `null` sem conexão. */
  get native(): unknown {
    return this.#socket;
  }

  get #log(): Logger {
    return this.#deps.log;
  }

  on<E extends TransportEventName>(event: E, handler: TransportEventHandler<E>): Unsubscribe {
    return this.#events.on(event, handler);
  }

  async connect(): Promise<void> {
    const attempt = ++this.#attempt;
    // Reconexão: o socket anterior já caiu, mas pode ainda estar de pé se alguém chamou
    // `connect()` duas vezes. Os eventos dele deixam de valer a partir daqui.
    this.#endSocket();
    const version = await this.#driver.version();
    const { state, saveCreds } = await loadAuthState(this.#deps.auth);
    // `disconnect()` ou outro `connect()` enquanto as credenciais carregavam.
    if (attempt !== this.#attempt) return;

    const socket = this.#driver.makeSocket({
      auth: state,
      logger: toBaileysLogger(this.#log.child({ lib: 'baileys' })),
      version,
    });
    this.#socket = socket;
    const current = (): boolean => this.#socket === socket;
    // Gravações em fila: uma `creds.update` não pode sobrescrever a seguinte fora de ordem.
    let saving = Promise.resolve();
    // Mostrou QR/código e não abriu: o 408 que vier é o pareamento que expirou.
    let pairing = false;
    let codeRequested = false;

    socket.ev.on('creds.update', () => {
      if (!current()) return;
      saving = saving.then(saveCreds).catch((error: unknown) => {
        this.#log.error('falha ao gravar as credenciais da sessão', { err: error });
      });
    });

    // Em fila: a normalização é assíncrona (telefone de LID) e não pode inverter a ordem de
    // chegada, que a fila de entrada do bot preserva por chat.
    let inbound = Promise.resolve();
    const env = this.#normalizeEnv(socket, state);
    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (!current()) return;
      // `append` é histórico e cópia de sincronização; só `notify` é mensagem nova.
      if (type !== 'notify') return;
      for (const raw of messages) {
        // Status (stories) não é conversa: fica de fora até haver um evento para ele.
        if (raw.key.remoteJid && isJidStatusBroadcast(raw.key.remoteJid)) continue;
        inbound = inbound
          .then(() => toMessage(raw, env))
          .then(
            (message) => {
              if (message !== null && current()) this.#events.emit('message', message);
            },
            (error: unknown) => {
              this.#log.error('falha ao normalizar mensagem do Baileys; descartada', {
                err: error,
                messageId: raw.key.id,
              });
            },
          );
      }
    });

    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (!current()) return;
      if (qr !== undefined) {
        pairing = true;
        if (this.#pairing === 'qr') {
          this.#events.emit('connection.qr', { qr });
        } else if (!codeRequested && !state.creds.registered) {
          // Um código por tentativa: o Baileys segue girando o QR, mas o código vale até a
          // tentativa expirar (408), e aí a política pede outro.
          codeRequested = true;
          this.#requestPairingCode(socket, this.#pairing.phone);
        }
      }
      switch (connection) {
        case 'connecting':
          this.#events.emit('connection.status', { status: 'connecting' });
          return;
        case 'open':
          pairing = false;
          this.#self = socket.user ? toContact(socket.user) : null;
          this.#events.emit('connection.status', { status: 'open' });
          return;
        case 'close': {
          this.#socket = null;
          const error = lastDisconnect?.error;
          const reason = toDisconnectReason(error, { pairing });
          this.#events.emit('connection.status', { status: 'closed', reason, error });
          return;
        }
      }
    });
  }

  async disconnect(): Promise<void> {
    this.#attempt++;
    this.#endSocket();
  }

  /** Encerra o socket atual sem emitir nada: quem chamou já sabe que a conexão acabou. */
  #endSocket(): void {
    const socket = this.#socket;
    if (socket === null) return;
    this.#socket = null;
    socket.end(undefined).catch((error: unknown) => {
      this.#log.warn('falha ao encerrar o socket do Baileys', { err: error });
    });
  }

  #normalizeEnv(socket: BaileysSocket, state: AuthenticationState): NormalizeEnv {
    const logger = toBaileysLogger(this.#log.child({ lib: 'baileys' }));
    const media = { reuploadRequest: (m: WAMessage) => socket.updateMediaMessage(m), logger };
    return {
      // Lido a cada mensagem: no primeiro pareamento o `me` só chega depois do socket criado.
      get selfIds() {
        const me = state.creds.me;
        return [me?.id, me?.lid].flatMap((id) => (id ? [jidNormalizedUser(id)] : []));
      },
      pnForLid: (lid) =>
        socket.signalRepository.lidMapping.getPNForLID(lid).catch((error: unknown) => {
          // Sem o par, o contato segue com `phone: null`: os papéis falham fechados (ADR 0046).
          this.#log.warn('falha ao resolver o telefone de um LID', { err: error, lid });
          return null;
        }),
      download: (raw) => downloadMediaMessage(raw, 'buffer', {}, media),
      stream: async (raw) =>
        Readable.toWeb(
          await downloadMediaMessage(raw, 'stream', {}, media),
        ) as ReadableStream<Uint8Array>,
    };
  }

  #requestPairingCode(socket: BaileysSocket, phone: string): void {
    socket.requestPairingCode(phone).then(
      (code) => {
        if (this.#socket === socket) this.#events.emit('connection.pairing-code', { code });
      },
      (error: unknown) => {
        // Sem código, a tentativa expira (`qr-timeout`) e a próxima pede outro.
        this.#log.error('falha ao pedir o código de pareamento', { err: error });
      },
    );
  }

  async send(
    _chatId: string,
    content: OutgoingContent,
    _options?: SendOptions,
  ): Promise<MessageKey> {
    throw new UnsupportedError(capabilitiesForSend(content)[0] ?? 'send.text', this.name);
  }

  async react(_key: MessageKey, _emoji: string | null): Promise<void> {
    throw new UnsupportedError('reactions', this.name);
  }

  async edit(_key: MessageKey, _text: string): Promise<void> {
    throw new UnsupportedError('message.edit', this.name);
  }

  async delete(_key: MessageKey): Promise<void> {
    throw new UnsupportedError('message.delete', this.name);
  }

  async sendPresence(_chatId: string, _presence: Presence): Promise<void> {
    throw new UnsupportedError('presence', this.name);
  }

  async getGroupMetadata(_groupId: string): Promise<GroupMetadata> {
    throw new UnsupportedError('groups', this.name);
  }

  async updateGroupParticipants(
    _groupId: string,
    _participantIds: readonly string[],
    _action: GroupParticipantAction,
  ): Promise<void> {
    throw new UnsupportedError('groups.admin', this.name);
  }
}

/** A própria sessão: o `id` do Baileys traz o aparelho (`5511…:12@s.whatsapp.net`). */
function toContact(user: BaileysContact): Contact {
  const id = jidNormalizedUser(user.id);
  const jid = jidDecode(id);
  const phone =
    jid?.server === 's.whatsapp.net' ? jid.user : (jidDecode(user.phoneNumber)?.user ?? null);
  return { id, name: user.name ?? user.notify ?? null, phone };
}
