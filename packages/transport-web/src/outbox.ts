// Buffer de envio para a conversa sem conexão aberta (ADR 0077): até 100 frames por conversa, por
// 1 h, entregues em ordem no próximo `auth`. Sem timer: a validade é conferida quando o buffer anda.

import type { ServerFrame } from './protocol.ts';

export const OUTBOX_MAX_FRAMES = 100;
export const OUTBOX_TTL_MS: number = 60 * 60 * 1000;

interface Pending {
  readonly frame: ServerFrame;
  readonly expiresAt: number;
}

export class Outbox {
  // Reinserida a cada frame novo: a conversa parada há mais tempo fica na frente do mapa.
  readonly #chats = new Map<string, Pending[]>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  push(chatId: string, frame: ServerFrame): void {
    const now = this.#now();
    this.#prune(now);
    const pending = this.#chats.get(chatId) ?? [];
    this.#chats.delete(chatId);
    pending.push({ frame, expiresAt: now + OUTBOX_TTL_MS });
    if (pending.length > OUTBOX_MAX_FRAMES) pending.shift();
    this.#chats.set(chatId, pending);
  }

  /** Tira e devolve o que ainda vale para a conversa, em ordem. */
  drain(chatId: string): ServerFrame[] {
    const pending = this.#chats.get(chatId);
    if (pending === undefined) return [];
    this.#chats.delete(chatId);
    const now = this.#now();
    return pending.filter((item) => item.expiresAt > now).map((item) => item.frame);
  }

  clear(): void {
    this.#chats.clear();
  }

  get size(): number {
    return this.#chats.size;
  }

  /** Solta as conversas cujo frame mais novo já venceu: todos os outros venceram antes. */
  #prune(now: number): void {
    for (const [chatId, pending] of this.#chats) {
      const newest = pending.at(-1);
      if (newest !== undefined && newest.expiresAt > now) break;
      this.#chats.delete(chatId);
    }
  }
}
