// Histórico multi-turno da Luma, em memória. Uma conversa é um chat privado ou, em grupo, uma
// pessoa naquele grupo (`historyKey`), para a Luma não misturar o que cada um disse a ela.

import type { Message } from '@usebridger/core';

export interface Turn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface History {
  /** Registra a fala e a resposta; passando de `maxMessages` turnos, descarta os mais antigos. */
  add(key: string, user: string, assistant: string): void;
  /** Turnos vivos da conversa, do mais antigo ao mais novo; expirada, vazio. */
  turns(key: string): Turn[];
  /** Esquece a conversa. `true` se havia algo. */
  clear(key: string): boolean;
  /** Conversas vivas, para o `!luma stats`. */
  size(): number;
}

interface Options {
  /** Turnos (fala + resposta contam dois) guardados por conversa. */
  readonly maxMessages: number;
  /** Conversa parada por mais que isso é esquecida. */
  readonly maxAgeMs: number;
  /** Relógio injetável; os testes não esperam. */
  readonly now?: () => number;
}

/** Não varre todas as conversas a cada `add`: no máximo uma vez por minuto. */
const SWEEP_EVERY_MS = 60_000;

/**
 * Sem timer: a conversa expirada é descartada na leitura e numa varredura espaçada dentro do
 * `add`. Nada sobrevive ao `stop()`, e o `teardown` não precisa limpar nada.
 */
export function createHistory({ maxMessages, maxAgeMs, now = Date.now }: Options): History {
  const store = new Map<string, { turns: Turn[]; touched: number }>();
  let lastSweep = now();

  const alive = (key: string) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (now() - entry.touched > maxAgeMs) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    add(key, user, assistant) {
      const at = now();
      if (at - lastSweep > SWEEP_EVERY_MS) {
        lastSweep = at;
        for (const k of [...store.keys()]) alive(k);
      }
      const entry = alive(key) ?? { turns: [], touched: at };
      entry.turns.push({ role: 'user', text: user }, { role: 'assistant', text: assistant });
      if (entry.turns.length > maxMessages) entry.turns.splice(0, entry.turns.length - maxMessages);
      entry.touched = at;
      store.set(key, entry);
    },
    turns(key) {
      return [...(alive(key)?.turns ?? [])];
    },
    clear: (key) => store.delete(key),
    size() {
      for (const k of [...store.keys()]) alive(k);
      return store.size;
    },
  };
}

/**
 * Chave da conversa. Em grupo, uma por pessoa; em privado, uma por chat. O ID do contato só é
 * único dentro do transport, mas o `ctx.storage` e este histórico já são do bot (uma sessão).
 */
export function historyKey(message: Pick<Message, 'chat' | 'sender'>): string {
  return message.chat.isGroup ? `${message.chat.id}:${message.sender.id}` : message.chat.id;
}
