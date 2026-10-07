// Contrato do StoragePort (M1-10, ADR 0014/0015). O M1-10 completa este arquivo; os nomes
// exportados aqui são usados por outros módulos e não mudam.

/** Valor serializável que todo adapter (memória, SQLite, Postgres) consegue guardar. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** KV do plugin; o namespace (nome do plugin) é aplicado pelo kernel, não pelo plugin. */
export interface KeyValueStore {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  /** `true` se a chave existia. */
  delete(key: string): Promise<boolean>;
}

export interface CollectionOptions {
  /** Campos consultados com frequência; o adapter cria índice para eles. */
  readonly indexes?: readonly string[];
}

/** Coleção de documentos do plugin. Filtros, ordenação e limite: M1-10. */
export interface Collection<T extends { readonly [key: string]: JsonValue }> {
  insert(document: T): Promise<string>;
}

/** Storage visto por um plugin (`ctx.storage`), já isolado no namespace dele. */
export interface PluginStorage {
  readonly kv: KeyValueStore;
  collection<T extends { readonly [key: string]: JsonValue }>(
    name: string,
    options?: CollectionOptions,
  ): Collection<T>;
}

/** Adapter de armazenamento que o bot recebe na config (memória, SQLite, Postgres). */
export interface StoragePort {
  /** Storage isolado de um plugin (ou do próprio kernel, com um namespace reservado). */
  forNamespace(namespace: string): PluginStorage;
  close(): Promise<void>;
}
