// Auth state do Baileys sobre o `AuthStateStore` do bot (ADR 0014/0037), no lugar do
// `useMultiFileAuthState`. O store só guarda JSON; os `Buffer`/`Uint8Array` do Baileys vão e
// voltam pelo `BufferJSON`, como no arquivo que o `useMultiFileAuthState` gravaria.

import type { JsonValue } from '@zapforge/core';
import type { AuthKeyData, AuthStateStore } from '@zapforge/core/adapter';
import {
  type AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  type SignalDataSet,
  type SignalDataTypeMap,
} from 'baileys';

export interface StoredAuthState {
  readonly state: AuthenticationState;
  /** Grava as credenciais atuais. O Baileys as altera no lugar antes de emitir `creds.update`. */
  readonly saveCreds: () => Promise<void>;
}

export async function loadAuthState(store: AuthStateStore): Promise<StoredAuthState> {
  const stored = await store.getCreds();
  const creds = stored === undefined ? initAuthCreds() : fromJson(stored);
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const raw = await store.getKeys(type, ids);
          const keys: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          for (const [id, value] of Object.entries(raw)) {
            // O Baileys espera a instância do protobuf, não o objeto cru (como no
            // `useMultiFileAuthState`).
            keys[id] =
              type === 'app-state-sync-key'
                ? proto.Message.AppStateSyncKeyData.fromObject(fromJson(value))
                : fromJson(value);
          }
          return keys;
        },
        set: (data) => store.setKeys(toKeyData(data)),
      },
    },
    saveCreds: () => store.setCreds(toJson(creds)),
  };
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
