// Storage do plugin com escopo de tenant (ADR 0072): cada operação vai ao namespace do tenant
// corrente (`<plugin>@<tenant>`) ou, sem tenant, ao do plugin, como antes. A escolha é feita na
// chamada, não na criação: uma coleção obtida no `setup` grava no tenant do handler que a usa.

import type { TenantScope } from '#tenant/scope.ts';
import { assertTenantId, pluginStorage } from './namespace.ts';
import type {
  Collection,
  CollectionOptions,
  JsonValue,
  KeyValueStore,
  PluginStorage,
  StoragePort,
} from './types.ts';

/** `ctx.storage`: o storage do tenant corrente, mais a escolha explícita de um tenant. */
export interface TenantStorage extends PluginStorage {
  /**
   * Storage de um tenant escolhido pelo plugin, fora do escopo corrente: no `setup`, num job sem
   * tenant ou num plugin de administração que atende vários. Lança `TypeError` com ID vazio.
   */
  forTenant(tenantId: string): PluginStorage;
}

/**
 * `ctx.storage`: o da sessão do bot e, em `shared`, o comum a todas as sessões que dividem o
 * storage (ADR 0075). Os dois seguem o tenant corrente.
 */
export interface PluginContextStorage extends TenantStorage {
  /**
   * Dados do plugin comuns a todos os bots no mesmo storage (WhatsApp, Telegram, web...). Os IDs
   * de contato e de chat só são únicos dentro de um transport: componha a chave com
   * `ctx.transportName` quando ela vier de um ID.
   */
  readonly shared: TenantStorage;
}

/**
 * Storage do plugin que segue o `scope`. Os storages por tenant ficam em cache (as coleções do
 * adapter criam o índice na primeira operação de cada objeto); o número de tenants de um bot é o
 * de clientes do dono, não o de usuários.
 */
export function tenantStorage(
  port: StoragePort,
  pluginName: string,
  scope: TenantScope,
): TenantStorage {
  const base = pluginStorage(port, pluginName);
  const byTenant = new Map<string, PluginStorage>();
  const forTenant = (tenant: string): PluginStorage => {
    let storage = byTenant.get(tenant);
    if (storage === undefined) {
      storage = pluginStorage(port, pluginName, tenant);
      byTenant.set(tenant, storage);
    }
    return storage;
  };
  const current = (): PluginStorage => {
    const tenant = scope.current;
    return tenant === undefined ? base : forTenant(tenant);
  };

  const kv: KeyValueStore = {
    get: <T extends JsonValue = JsonValue>(key: string) => current().kv.get<T>(key),
    set: (key: string, value: JsonValue) => current().kv.set(key, value),
    delete: (key: string) => current().kv.delete(key),
  };
  return {
    kv,
    collection<T extends { readonly [key: string]: JsonValue }>(
      name: string,
      options?: CollectionOptions,
    ): Collection<T> {
      // Valida o nome e as opções já aqui, como o adapter faz: o erro sai no `setup`, não na
      // primeira mensagem.
      const untenanted = base.collection<T>(name, options);
      const collections = new Map<PluginStorage, Collection<T>>([[base, untenanted]]);
      const resolve = (): Collection<T> => {
        const storage = current();
        let collection = collections.get(storage);
        if (collection === undefined) {
          collection = storage.collection<T>(name, options);
          collections.set(storage, collection);
        }
        return collection;
      };
      type C = Collection<T>;
      return {
        insert: (document) => resolve().insert(document),
        get: (id) => resolve().get(id),
        find: (query?: Parameters<C['find']>[0]) => resolve().find(query),
        update: (target, patch) => resolve().update(target, patch),
        delete: (target) => resolve().delete(target),
      };
    },
    forTenant(tenantId) {
      assertTenantId(tenantId);
      return forTenant(tenantId);
    },
  };
}
