// Socket e driver falsos: o teste dirige o `connection.update` e o `creds.update` à mão, como o
// Baileys faria, sem rede.

import { EventEmitter } from 'node:events';
import type { Contact as BaileysContact, BaileysEventMap, WAVersion } from 'baileys';
import type { BaileysDriver, BaileysSocket, SocketConfig } from './transport.ts';

export class FakeSocket implements BaileysSocket {
  readonly config: SocketConfig;
  readonly pairingRequests: string[] = [];
  user: BaileysContact | undefined;
  ended = false;
  pairingCode: Promise<string> = Promise.resolve('ABCD1234');
  readonly #emitter = new EventEmitter();

  readonly ev = {
    on: <E extends keyof BaileysEventMap>(
      event: E,
      listener: (arg: BaileysEventMap[E]) => void,
    ): void => {
      this.#emitter.on(event, listener);
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
