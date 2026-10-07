// Contrato do StoragePort (M1-10, ADR 0014/0015). A semântica fina (tipos mistos, campo
// ausente, ordenação, cópias) está em docs/storage.md e é fixada pela suíte de contrato
// (`@zapforge/core/storage-contract`): todo adapter — memória, SQLite, Postgres — passa nela.
// Nada aqui pode amarrar a SQL nem a um engine (ADR 0015).

/** Valor serializável que todo adapter (memória, SQLite, Postgres) consegue guardar. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Objeto JSON: o formato de um documento de coleção. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** KV do plugin; o namespace (nome do plugin) é aplicado pelo kernel, não pelo plugin. */
export interface KeyValueStore {
  /** Cópia do valor guardado, ou `undefined` se a chave não existe. */
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  /** Grava uma cópia JSON do valor (semântica de `JSON.stringify`), substituindo a anterior. */
  set(key: string, value: JsonValue): Promise<void>;
  /** `true` se a chave existia. */
  delete(key: string): Promise<boolean>;
}

export interface CollectionOptions {
  /**
   * Campos de primeiro nível consultados com frequência; o adapter cria índice para eles.
   * É só dica de desempenho: o resultado das consultas não muda. Nomes seguem as regras de
   * campo de filtro (`[A-Za-z_][A-Za-z0-9_]*`).
   */
  readonly indexes?: readonly string[];
}

/** Valor escalar: o que filtros comparam. Arrays e objetos não entram em filtros. */
export type Scalar = string | number | boolean | null;

/** Campo de primeiro nível de `T` ou o `id` gerado pelo adapter. */
export type FieldName<T> = (keyof T & string) | 'id';

/**
 * Operadores de um campo; vários no mesmo objeto combinam com E (`{ gte: 1, lt: 5 }`).
 * Campo ausente vale `null`. `eq`/`ne`/`in` comparam tipo e valor (`1` ≠ `'1'` ≠ `true`).
 * `gt`/`gte`/`lt`/`lte` só casam com valor do mesmo tipo do operando (número com número,
 * texto com texto, por code point); `null`, ausente ou outro tipo nunca casam.
 */
export interface FieldOperators {
  readonly eq?: Scalar;
  readonly ne?: Scalar;
  readonly gt?: string | number;
  readonly gte?: string | number;
  readonly lt?: string | number;
  readonly lte?: string | number;
  /** Casa se for igual (`eq`) a algum item. `[]` não casa com nada. */
  readonly in?: readonly Scalar[];
}

/** Escalar = `eq` implícito; objeto = operadores. */
export type FieldCondition = Scalar | FieldOperators;

/** Filtro por campos de primeiro nível, combinados com E. `{}` casa com todos. */
export type Where<T> = { readonly [K in FieldName<T>]?: FieldCondition };

export type SortDirection = 'asc' | 'desc';

/** Campo (crescente) ou campo com direção. */
export type Sort<T> =
  | FieldName<T>
  | { readonly field: FieldName<T>; readonly direction?: SortDirection };

export interface FindQuery<T> {
  readonly where?: Where<T>;
  /**
   * Um ou mais critérios, em ordem de precedência. Entre tipos, a ordem crescente é
   * `null`/ausente < booleano < número < texto < array/objeto; empates (e consulta sem
   * `orderBy`) seguem a ordem de inserção.
   */
  readonly orderBy?: Sort<T> | readonly Sort<T>[];
  /** Inteiro >= 0. */
  readonly limit?: number;
  /** Inteiro >= 0; padrão 0. */
  readonly offset?: number;
}

/** Documento como volta das consultas: os campos gravados mais o `id` gerado. */
export type WithId<T> = T & { readonly id: string };

/** Atualização rasa: substitui só os campos de primeiro nível presentes. */
export type Patch<T> = { readonly [K in keyof T]?: T[K] };

/** Alvo de `update`/`delete`: um `id` ou um filtro. */
export type Target<T> = string | Where<T>;

/**
 * Coleção de documentos do plugin. Documentos são objetos JSON; `id` é reservado (gerado pelo
 * adapter, nunca gravado como campo). Tudo que entra e sai é cópia.
 */
export interface Collection<T extends { readonly [key: string]: JsonValue }> {
  /** Grava o documento e devolve o `id` gerado (texto opaco, único na coleção). */
  insert(document: T): Promise<string>;
  get(id: string): Promise<WithId<T> | undefined>;
  find(query?: FindQuery<T>): Promise<WithId<T>[]>;
  /** Aplica `patch` (raso) aos documentos do alvo; devolve quantos casaram. */
  update(target: Target<T>, patch: Patch<T>): Promise<number>;
  /** Remove os documentos do alvo; devolve quantos removeu. `delete({})` esvazia a coleção. */
  delete(target: Target<T>): Promise<number>;
}

/** Storage visto por um plugin (`ctx.storage`), já isolado no namespace dele. */
export interface PluginStorage {
  readonly kv: KeyValueStore;
  collection<T extends { readonly [key: string]: JsonValue }>(
    name: string,
    options?: CollectionOptions,
  ): Collection<T>;
}

/**
 * Lote de chaves do auth state: tipo → id → valor. `null` remove a chave. Mesmo formato do
 * `SignalKeyStore.set` do Baileys, mas com valores já em JSON.
 */
export type AuthKeyData = {
  readonly [type: string]: { readonly [id: string]: JsonValue | null };
};

/**
 * Auth state de uma sessão do transport (ADR 0014; substitui o `useMultiFileAuthState`).
 * Genérico: credenciais são um valor JSON e as chaves ficam agrupadas por tipo e id. Quem
 * converte `Buffer`/`Uint8Array` para JSON e de volta é o transport (ex.: `BufferJSON`).
 */
export interface AuthStateStore {
  /** Credenciais gravadas, ou `undefined` se a sessão ainda não pareou. */
  getCreds(): Promise<JsonValue | undefined>;
  setCreds(creds: JsonValue): Promise<void>;
  /** Valores dos `ids` do `type`; ids sem valor ficam fora do objeto. */
  getKeys(type: string, ids: readonly string[]): Promise<Record<string, JsonValue>>;
  /** Grava o lote inteiro; `null` remove. O adapter aplica o lote numa transação. */
  setKeys(data: AuthKeyData): Promise<void>;
  /** Apaga credenciais e chaves da sessão (logout). */
  clear(): Promise<void>;
}

/** Adapter de armazenamento que o bot recebe na config (memória, SQLite, Postgres). */
export interface StoragePort {
  /**
   * Storage isolado de um namespace: nenhum outro namespace vê ou altera seus dados. Plugins
   * recebem o deles via `pluginStorage`; o kernel usa `kernelStorage` (namespace reservado).
   */
  forNamespace(namespace: string): PluginStorage;
  /**
   * Auth state de uma sessão do transport, isolado das outras sessões e dos namespaces. Só monta
   * o objeto, sem I/O: o `createBot` o chama para entregar à fábrica do transport (ADR 0037).
   */
  authState(session: string): AuthStateStore;
  /** Libera recursos. Idempotente; depois dele toda operação rejeita com `StorageClosedError`. */
  close(): Promise<void>;
}
