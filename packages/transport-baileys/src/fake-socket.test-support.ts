// Socket e driver falsos: o teste dirige o `connection.update` e o `creds.update` à mão, como o
// Baileys faria, sem rede. O envio e as ações ficam gravados em `sent`/`presences`/`groupUpdates`.

import { EventEmitter } from 'node:events';
import type {
  AnyMessageContent,
  Contact as BaileysContact,
  BaileysEventMap,
  GroupMetadata as BaileysGroupMetadata,
  MiscMessageGenerationOptions,
  ParticipantAction,
  WAMessage,
  WAPresence,
  WAVersion,
} from 'baileys';
import type { BaileysDriver, BaileysSocket, SocketConfig } from './transport.ts';

export class FakeSocket implements BaileysSocket {
  readonly config: SocketConfig;
  readonly pairingRequests: string[] = [];
  user: BaileysContact | undefined;
  ended = false;
  pairingCode: Promise<string> = Promise.resolve('ABCD1234');
  /** Pares LID → JID de telefone que a sessão "conhece". */
  readonly lids: Map<string, string> = new Map();
  readonly sent: {
    readonly jid: string;
    readonly content: AnyMessageContent;
    readonly options: MiscMessageGenerationOptions | undefined;
  }[] = [];
  readonly presences: { readonly type: WAPresence; readonly jid: string | undefined }[] = [];
  /** Metadados que o "servidor" devolve, por grupo; sem entrada, a consulta falha. */
  readonly groups: Map<string, BaileysGroupMetadata> = new Map();
  readonly groupQueries: string[] = [];
  readonly groupUpdates: {
    readonly jid: string;
    readonly participants: string[];
    readonly action: ParticipantAction;
  }[] = [];
  /** Status por participante na resposta do `groupParticipantsUpdate`; padrão `'200'`. */
  readonly participantStatus: Map<string, string> = new Map();
  #nextId = 0;
  readonly #emitter = new EventEmitter();

  readonly ev = {
    on: <E extends keyof BaileysEventMap>(
      event: E,
      listener: (arg: BaileysEventMap[E]) => void,
    ): void => {
      this.#emitter.on(event, listener);
    },
  };

  readonly signalRepository: BaileysSocket['signalRepository'] = {
    lidMapping: {
      getPNForLID: async (lid: string): Promise<string | null> => this.lids.get(lid) ?? null,
    },
  };

  constructor(config: SocketConfig) {
    this.config = config;
  }

  emit<E extends keyof BaileysEventMap>(event: E, arg: BaileysEventMap[E]): void {
    this.#emitter.emit(event, arg);
  }

  /** Como o Baileys: altera as credenciais no lugar e avisa. */
  updateCreds(update: Partial<SocketConfig['auth']['creds']>): void {
    Object.assign(this.config.auth.creds, update);
    this.emit('creds.update', update);
  }

  async end(_error: Error | undefined): Promise<void> {
    this.ended = true;
  }

  requestPairingCode(phoneNumber: string): Promise<string> {
    this.pairingRequests.push(phoneNumber);
    return this.pairingCode;
  }

  async updateMediaMessage(message: WAMessage): Promise<WAMessage> {
    return message;
  }

  /** Como o Baileys: devolve a mensagem criada, com id novo e `fromMe`. */
  async sendMessage(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined> {
    this.sent.push({ jid, content, options });
    return { key: { remoteJid: jid, id: `SENT-${++this.#nextId}`, fromMe: true } };
  }

  async sendPresenceUpdate(type: WAPresence, toJid?: string): Promise<void> {
    this.presences.push({ type, jid: toJid });
  }

  async groupMetadata(jid: string): Promise<BaileysGroupMetadata> {
    this.groupQueries.push(jid);
    const metadata = this.groups.get(jid);
    if (!metadata) throw new Error(`item-not-found: ${jid}`);
    return metadata;
  }

  async groupParticipantsUpdate(
    jid: string,
    participants: string[],
    action: ParticipantAction,
  ): Promise<{ status: string; jid: string | undefined }[]> {
    this.groupUpdates.push({ jid, participants, action });
    return participants.map((p) => ({ status: this.participantStatus.get(p) ?? '200', jid: p }));
  }
}

export class FakeDriver implements BaileysDriver {
  readonly sockets: FakeSocket[] = [];
  readonly fixedVersion: WAVersion = [2, 3000, 1];

  makeSocket(config: SocketConfig): FakeSocket {
    const socket = new FakeSocket(config);
    this.sockets.push(socket);
    return socket;
  }

  async version(): Promise<WAVersion> {
    return this.fixedVersion;
  }

  /** Socket da tentativa mais recente. */
  get last(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error('nenhum socket criado');
    return socket;
  }
}

/** Erro como o Baileys o entrega no `lastDisconnect` (um `Boom`). */
export function boom(statusCode: number, message = 'fechou'): Error {
  return Object.assign(new Error(message), { output: { statusCode } });
}
