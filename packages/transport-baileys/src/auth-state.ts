// Auth state do Baileys sobre o `AuthStateStore` do bot (ADR 0014/0037), no lugar do
// `useMultiFileAuthState`. O store só guarda JSON; os `Buffer`/`Uint8Array` do Baileys vão e
// voltam pelo `BufferJSON`, como no arquivo que o `useMultiFileAuthState` gravaria.

import type { JsonValue } from '@zapforge/core';
import type { AuthKeyData, AuthStateStore } from '@zapforge/core/adapter';
import {
  type AuthenticationState,
  BufferJSON,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
  type SignalDataSet,
  type SignalDataTypeMap,
} from 'baileys';
import type { ILogger } from './logger.ts';

export interface StoredAuthState {
  readonly state: AuthenticationState;
  /** Grava as credenciais atuais. O Baileys as altera no lugar antes de emitir `creds.update`. */
  readonly saveCreds: () => Promise<void>;
}

/**
 * Monta o auth state de uma tentativa de conexão. As chaves passam por um cache em memória
 * (o do Baileys, 5 min por chave): o Signal lê a sessão do remetente a cada mensagem, e sem ele
 * cada leitura iria ao storage e repetiria a conversão do `BufferJSON`. O cache vive só nesta
 * tentativa: depois de um `clear()` do bot, a próxima começa vazia e não ressuscita chave
 * apagada. Ele não vê gravações de outro processo, o que não acontece porque a mesma sessão
 * não roda em dois (ADR 0036).
 */
export async function loadAuthState(
  store: AuthStateStore,
  logger: ILogger,
): Promise<StoredAuthState> {
  const stored = await store.getCreds();
  const creds = stored === undefined ? initAuthCreds() : fromJson(stored);
  const cached = makeCacheableSignalKeyStore(
    {
      get: async (type, ids) => {
        const raw = await store.getKeys(type, ids);
        const keys: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const [id, value] of Object.entries(raw)) {
          keys[id] =
            type === 'app-state-sync-key' ? toSyncKeyInstance(fromJson(value)) : fromJson(value);
        }
        return keys;
      },
      set: (data) => store.setKeys(toKeyData(data)),
    },
    logger,
  );
  return {
    state: {
      creds,
      keys: {
        // O cache guarda o `null` de uma chave apagada e o devolve; aqui ela some do resultado,
        // como na leitura direta do storage.
        get: async (type, ids) => {
          const found = await cached.get(type, ids);
          for (const id of Object.keys(found)) {
            if (found[id] === null || found[id] === undefined) delete found[id];
          }
          return found;
        },
        // O cache guarda o que recebe; convertido aqui, ele devolve o mesmo que o storage.
        set: (data) => cached.set(withSyncKeyInstances(data)),
      },
    },
    saveCreds: () => store.setCreds(toJson(creds)),
  };
}

// O Baileys espera a instância do protobuf, não o objeto cru (como no `useMultiFileAuthState`).
function toSyncKeyInstance(value: object): proto.Message.AppStateSyncKeyData {
  return value instanceof proto.Message.AppStateSyncKeyData
    ? value
    : proto.Message.AppStateSyncKeyData.fromObject(value);
}

function withSyncKeyInstances(data: SignalDataSet): SignalDataSet {
  const syncKeys = data['app-state-sync-key'];
  if (syncKeys === undefined) return data;
  const converted: SignalDataSet['app-state-sync-key'] = {};
  for (const [id, value] of Object.entries(syncKeys)) {
    converted[id] = value ? toSyncKeyInstance(value) : value;
  }
  return { ...data, 'app-state-sync-key': converted };
}

function toKeyData(data: SignalDataSet): AuthKeyData {
  const out: Record<string, Record<string, JsonValue | null>> = {};
  for (const [type, entries] of Object.entries(data)) {
    const converted: Record<string, JsonValue | null> = {};
    for (const [id, value] of Object.entries(entries ?? {})) {
      converted[id] = value === null || value === undefined ? null : toJson(value);
    }
    out[type] = converted;
  }
  return out;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer)) as JsonValue;
}

// biome-ignore lint/suspicious/noExplicitAny: o tipo vem de quem chama; o JSON já foi validado na gravação.
function fromJson(value: JsonValue): any {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
}
