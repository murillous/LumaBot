// Transport do WhatsApp sobre o Baileys (M2-1). Este módulo cuida da conexão: socket, QR ou
// código de pareamento, credenciais no storage do bot e o motivo de cada queda. Quem decide
// reconectar é o `Bot`, pela `ReconnectionPolicy` (ADR 0048). As mensagens recebidas passam
// pela normalização (`normalize.ts`) antes de virar o evento `message`, e os demais eventos do
// Baileys (reação, edição, apagamento, grupos) são convertidos em `events.ts`; o envio e as
// demais ações traduzem o formato do core em `outgoing.ts`.

import { Readable } from 'node:stream';
import type {
  Capability,
  Contact,
  FormattedText,
  GroupMetadata,
  GroupParticipantAction,
  Logger,
  MessageKey,
  OutgoingContent,
  Presence,
  SendOptions,
  Unsubscribe,
} from '@zapforge/core';
import {
  type Transport,
  type TransportDeps,
  type TransportEventHandler,
  type TransportEventName,
  type TransportEvents,
  TypedEmitter,
} from '@zapforge/core/adapter';
import {
  type AnyMessageContent,
  type AuthenticationState,
  type Contact as BaileysContact,
  type BaileysEventMap,
  type GroupMetadata as BaileysGroupMetadata,
  downloadMediaMessage,
  isJidGroup,
  isJidStatusBroadcast,
  jidDecode,
  jidNormalizedUser,
  type MiscMessageGenerationOptions,
  type ParticipantAction,
  type WAMessage,
  WAMessageStubType,
  type WAPresence,
  type WAVersion,
} from 'baileys';
import { loadAuthState } from './auth-state.ts';
import { toDisconnectReason } from './disconnect-reason.ts';
import {
  ContactBook,
  chatOf,
  toDeleted,
  toEdited,
  toGroupUpdated,
  toParticipantEvents,
  toReaction,
} from './events.ts';
import { renderWhatsApp } from './format.ts';
import { type ILogger, toBaileysLogger } from './logger.ts';
import { type NormalizeEnv, toMessage } from './normalize.ts';
import { toContent, toGroupMetadata, toQuoted, toWAKey } from './outgoing.ts';

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
  sendMessage(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined>;
  sendPresenceUpdate(type: WAPresence, toJid?: string): Promise<void>;
  groupMetadata(jid: string): Promise<BaileysGroupMetadata>;
  groupParticipantsUpdate(
    jid: string,
    participants: string[],
    action: ParticipantAction,
  ): Promise<readonly { readonly status: string; readonly jid: string | undefined }[]>;
}

export interface SocketConfig {
  readonly auth: AuthenticationState;
  readonly logger: ILogger;
  readonly version: WAVersion;
  /** Metadados de grupo já conhecidos: o envio em grupo não consulta o servidor de novo. */
  readonly cachedGroupMetadata: (jid: string) => Promise<BaileysGroupMetadata | undefined>;
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
  /**
   * Todas as capabilities do core, menos `actions`: o WhatsApp pelo Baileys não tem botões
   * confiáveis, e o kernel envia o menu em texto numerado (ADR 0062).
   */
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    'groups',
    'groups.add',
    'groups.remove',
    'groups.promote',
    'mentions',
    'reactions',
    'presence',
    'send.text',
    'send.image',
    'send.video',
    'send.audio',
    'send.voice',
    'send.sticker',
    'send.document',
    'media.download',
    'message.edit',
    'message.delete',
    'polls',
    'quoted',
  ]);

  readonly #pairing: BaileysPairing;
  readonly #driver: BaileysDriver;
  readonly #deps: TransportDeps;
  readonly #events: TypedEmitter<TransportEvents>;
  #socket: BaileysSocket | null = null;
  #self: Contact | null = null;
  /** Sobe a cada `connect()`/`disconnect()`: invalida a tentativa que ainda estava começando. */
  #attempt = 0;
  /**
   * Metadados por grupo (ADR 0046): o kernel os pede a cada comando `group-admin`. Invalidado
   * pelos eventos de grupo do Baileys e a cada conexão, porque a queda pode ter perdido algum.
   */
  readonly #groups = new Map<string, Promise<BaileysGroupMetadata>>();
  /** Contatos já vistos, entre conexões: o `contact.updated` sai só no que é novo. */
  readonly #contacts = new ContactBook();

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
    const logger = toBaileysLogger(this.#log.child({ lib: 'baileys' }));
    const { state, saveCreds } = await loadAuthState(this.#deps.auth, logger);
    // `disconnect()` ou outro `connect()` enquanto as credenciais carregavam.
    if (attempt !== this.#attempt) return;

    this.#groups.clear();
    const socket = this.#driver.makeSocket({
      auth: state,
      logger,
      version,
      cachedGroupMetadata: (jid) => this.#cachedGroup(jid),
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

    // Em fila: a conversão é assíncrona (telefone de LID) e não pode inverter a ordem de
    // chegada, que a fila de entrada do bot preserva por chat. Reação, edição e apagamento entram
    // na mesma fila: a edição de uma mensagem não passa à frente dela.
    let inbound = Promise.resolve();
    const enqueue = (work: () => Promise<void>, failure: string, messageId?: string | null) => {
      inbound = inbound.then(work).catch((error: unknown) => {
        this.#log.error(failure, { err: error, messageId });
      });
    };
    const env = this.#normalizeEnv(socket, state, logger);
    const contacts = this.#contacts;

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (!current()) return;
      // `append` é histórico e cópia de sincronização; só `notify` é mensagem nova.
      if (type !== 'notify') return;
      for (const raw of messages) {
        // Status (stories) não é conversa: fica de fora até haver um evento para ele.
        if (raw.key.remoteJid && isJidStatusBroadcast(raw.key.remoteJid)) continue;
        enqueue(
          async () => {
            const message = await toMessage(raw, env);
            if (message === null || !current()) return;
            // Antes da mensagem: quem guarda nomes já o tem ao tratá-la.
            const contact = message.fromMe ? null : contacts.observe(message.sender);
            if (contact !== null) this.#events.emit('contact.updated', contact);
            this.#events.emit('message', message);
          },
          'falha ao normalizar mensagem do Baileys; descartada',
          raw.key.id,
        );
      }
    });

    socket.ev.on('messages.reaction', (reactions) => {
      if (!current()) return;
      for (const item of reactions) {
        enqueue(
          async () => {
            const reaction = await toReaction(item, env, contacts);
            if (reaction !== null && current()) this.#events.emit('reaction', reaction);
          },
          'falha ao converter reação do Baileys; descartada',
          item.key.id,
        );
      }
    });

    socket.ev.on('messages.update', (updates) => {
      if (!current()) return;
      // A maior parte é recibo de entrega e leitura, que não tem evento no core.
      for (const item of updates) {
        if (item.update.message?.editedMessage) {
          enqueue(
            async () => {
              const message = await toEdited(item, env, contacts);
              if (message !== null && current()) this.#events.emit('message.edited', message);
            },
            'falha ao converter edição do Baileys; descartada',
            item.key.id,
          );
        } else if (item.update.messageStubType === WAMessageStubType.REVOKE) {
          enqueue(
            async () => {
              const deleted = await toDeleted(item, env, contacts);
              if (deleted !== null && current()) this.#events.emit('message.deleted', deleted);
            },
            'falha ao converter apagamento do Baileys; descartado',
            item.key.id,
          );
        }
      }
    });

    // Grupo criado com a sessão dentro: o Baileys avisa pelo `groups.upsert`, não pelos
    // participantes.
    socket.ev.on('groups.upsert', (groups) => {
      if (!current()) return;
      for (const { id } of groups) {
        enqueue(async () => {
          if (current()) this.#events.emit('group.joined', { chat: chatOf(id) });
        }, 'falha ao repassar grupo novo');
      }
    });
    socket.ev.on('groups.update', (updates) => {
      if (!current()) return;
      for (const update of updates) {
        if (update.id) this.#groups.delete(update.id);
        const changed = toGroupUpdated(update);
        if (changed === null) continue;
        enqueue(async () => {
          if (current()) this.#events.emit('group.updated', changed);
        }, 'falha ao repassar alteração de grupo');
      }
    });
    socket.ev.on('group-participants.update', (update) => {
      if (!current()) return;
      this.#groups.delete(update.id);
      enqueue(async () => {
        const { self, others } = await toParticipantEvents(update, env, contacts);
        if (!current()) return;
        if (self !== null) this.#events.emit(self, { chat: chatOf(update.id) });
        if (others !== null) this.#events.emit('group.participants', others);
      }, 'falha ao converter alteração de participantes do Baileys; descartada');
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

  #normalizeEnv(socket: BaileysSocket, state: AuthenticationState, logger: ILogger): NormalizeEnv {
    const media = { reuploadRequest: (m: WAMessage) => socket.updateMediaMessage(m), logger };
    return {
      // Lido a cada mensagem: no primeiro pareamento o `me` só chega depois do socket criado.
      get selfIds() {
        const me = state.creds.me;
        return [me?.id, me?.lid].flatMap((id) => (id ? [jidNormalizedUser(id)] : []));
      },
      pnForLid: (lid) => this.#pnForLid(socket, lid),
      download: (raw) => downloadMediaMessage(raw, 'buffer', {}, media),
      stream: async (raw) =>
        Readable.toWeb(
          await downloadMediaMessage(raw, 'stream', {}, media),
        ) as ReadableStream<Uint8Array>,
    };
  }

  #pnForLid(socket: BaileysSocket, lid: string): Promise<string | null> {
    return socket.signalRepository.lidMapping.getPNForLID(lid).catch((error: unknown) => {
      // Sem o par, o contato segue com `phone: null`: os papéis falham fechados (ADR 0046).
      this.#log.warn('falha ao resolver o telefone de um LID', { err: error, lid });
      return null;
    });
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

  async send(chatId: string, content: OutgoingContent, options?: SendOptions): Promise<MessageKey> {
    const sent = await this.#connected().sendMessage(
      chatId,
      toContent(content, options),
      options?.quoted ? { quoted: toQuoted(options.quoted) } : undefined,
    );
    const id = sent?.key.id;
    // O Baileys só devolve `undefined` para conteúdo que não vira mensagem (ex.: apagar); sem a
    // chave, não daria para reagir, editar nem apagar depois.
    if (!id) throw new Error('baileys: o envio não devolveu a chave da mensagem');
    return {
      chatId,
      id,
      fromMe: true,
      senderId: isJidGroup(chatId) ? (this.#self?.id ?? null) : null,
    };
  }

  async react(key: MessageKey, emoji: string | null): Promise<void> {
    // Texto vazio é como o WhatsApp remove a reação.
    await this.#connected().sendMessage(key.chatId, {
      react: { text: emoji ?? '', key: toWAKey(key) },
    });
  }

  async edit(key: MessageKey, text: string, formatted?: FormattedText): Promise<void> {
    if (!formatted) {
      await this.#connected().sendMessage(key.chatId, { text, edit: toWAKey(key) });
      return;
    }
    const rendered = renderWhatsApp(formatted);
    await this.#connected().sendMessage(key.chatId, {
      text: rendered.text,
      edit: toWAKey(key),
      ...(rendered.mentions.length > 0 && { mentions: [...rendered.mentions] }),
    });
  }

  async delete(key: MessageKey): Promise<void> {
    await this.#connected().sendMessage(key.chatId, { delete: toWAKey(key) });
  }

  async sendPresence(chatId: string, presence: Presence): Promise<void> {
    await this.#connected().sendPresenceUpdate(presence, chatId);
  }

  async getGroupMetadata(groupId: string): Promise<GroupMetadata> {
    const socket = this.#connected();
    let native = this.#groups.get(groupId);
    if (native === undefined) {
      const fetching = socket.groupMetadata(groupId);
      native = fetching;
      this.#groups.set(groupId, fetching);
      // Falha não fica no cache: a próxima chamada consulta de novo. O erro chega ao chamador
      // pela própria promise; este handler só limpa a entrada.
      fetching.catch(() => {
        if (this.#groups.get(groupId) === fetching) this.#groups.delete(groupId);
      });
    }
    return toGroupMetadata(await native, { pnForLid: (lid) => this.#pnForLid(socket, lid) });
  }

  async updateGroupParticipants(
    groupId: string,
    participantIds: readonly string[],
    action: GroupParticipantAction,
  ): Promise<void> {
    const results = await this.#connected().groupParticipantsUpdate(
      groupId,
      [...participantIds],
      action,
    );
    // Os participantes mudaram mesmo que o evento do Baileys ainda não tenha chegado.
    this.#groups.delete(groupId);
    // O servidor responde por participante; fora do 200, aquele falhou (ex.: 403 sem ser admin,
    // 409 já no grupo). Falha parcial também lança: quem chamou precisa saber.
    const failed = results.filter((r) => r.status !== '200');
    if (failed.length > 0) {
      const list = failed.map((r) => `${r.jid ?? '?'} (${r.status})`).join(', ');
      throw new Error(`baileys: ${action} recusado para ${list}`);
    }
  }

  /** Socket da conexão atual; sem ele, a ação falha na hora em vez de esperar. */
  #connected(): BaileysSocket {
    if (this.#socket === null) throw new Error('baileys: sem conexão');
    return this.#socket;
  }

  /** Para o envio em grupo: usa a consulta que já existe, sem disparar outra. */
  async #cachedGroup(jid: string): Promise<BaileysGroupMetadata | undefined> {
    return this.#groups.get(jid)?.catch(() => undefined);
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
