// Prefixo de comando por tipo de chat e por chat (ADR 0063). O padrão vem da config, e o override
// de um chat fica no storage do kernel. O override é lido inteiro no boot: o roteador consulta
// o prefixo a cada mensagem, e o caminho quente não pode ir ao storage (plano §7).

import type { Chat } from '#message/types.ts';
import { kernelStorage } from '#storage/namespace.ts';
import type { Collection, StoragePort } from '#storage/types.ts';

export const DEFAULT_PREFIX = '!';

/**
 * Prefixo da config: um texto para todo chat, ou um por tipo de chat. `group` vale para todo
 * chat que não é `dm` (grupo, canal, thread). Tipo omitido: `'!'`. Vazio é permitido.
 */
export type PrefixConfig = string | { readonly dm?: string; readonly group?: string };

/** Prefixos vistos pelo plugin (`ctx.prefixes`). */
export interface Prefixes {
  /** Prefixo em vigor no chat: o override dele ou o padrão do tipo de chat. */
  get(chat: Pick<Chat, 'id' | 'isGroup'>): string;
  /** Grava o override do chat. Vazio é permitido; começado por espaço em branco lança. */
  set(chatId: string, prefix: string): Promise<void>;
  /** Apaga o override, e o chat volta ao padrão do tipo. `true` se havia override. */
  reset(chatId: string): Promise<boolean>;
}

export interface PrefixStore extends Prefixes {
  /** Lê os overrides do storage. O bot chama no boot, antes do `setup` dos plugins. */
  load(): Promise<void>;
}

type PrefixDocument = { chat: string; prefix: string };

const LEADING_WHITESPACE = /^\s/;

/**
 * Valida um prefixo. O texto da mensagem perde os espaços iniciais antes do match, então um
 * prefixo começado por espaço em branco nunca casaria.
 */
export function validatePrefix(prefix: unknown, label: string): string {
  if (typeof prefix !== 'string') throw new TypeError(`${label}: o prefixo deve ser texto`);
  if (LEADING_WHITESPACE.test(prefix)) {
    throw new TypeError(`${label}: o prefixo não pode começar com espaço em branco`);
  }
  return prefix;
}

export function createPrefixStore(
  config: PrefixConfig | undefined,
  port: StoragePort,
): PrefixStore {
  const split = typeof config === 'object' ? config : { dm: config, group: config };
  const dm = validatePrefix(split.dm ?? DEFAULT_PREFIX, 'prefix.dm').toLowerCase();
  const group = validatePrefix(split.group ?? DEFAULT_PREFIX, 'prefix.group').toLowerCase();
  const overrides = new Map<string, string>();
  // A coleção só é aberta no primeiro uso: o `createBot` não faz I/O.
  let chats: Collection<PrefixDocument> | undefined;
  const collection = (): Collection<PrefixDocument> => {
    chats ??= kernelStorage(port, 'prefixes').collection<PrefixDocument>('chats', {
      indexes: ['chat'],
    });
    return chats;
  };
  // Escritas em fila: duas trocas seguidas no mesmo chat terminam na ordem em que foram pedidas,
  // no storage e no Map.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    async load() {
      for (const { chat, prefix } of await collection().find()) overrides.set(chat, prefix);
    },

    get(chat) {
      return overrides.get(chat.id) ?? (chat.isGroup ? group : dm);
    },

    set(chatId, prefix) {
      const value = validatePrefix(prefix, 'prefixes.set').toLowerCase();
      return enqueue(async () => {
        // Storage primeiro: se a escrita falha, o Map continua igual ao que está gravado.
        const updated = await collection().update({ chat: chatId }, { prefix: value });
        if (updated === 0) await collection().insert({ chat: chatId, prefix: value });
        overrides.set(chatId, value);
      });
    },

    reset(chatId) {
      return enqueue(async () => {
        const removed = await collection().delete({ chat: chatId });
        overrides.delete(chatId);
        return removed > 0;
      });
    },
  };
}
