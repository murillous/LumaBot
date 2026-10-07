// Leitura estrutural de schemas Zod: achar o tipo "de verdade" atrás de optional/default/pipe,
// percorrer campos de objeto e saber se um campo é secreto. Olha `_zod.def.type` (string) em vez
// de `instanceof`, para funcionar mesmo se o plugin trouxer outra cópia do Zod. O core importa
// o Zod só como tipo: carregar o módulo cria globais (`__zod_globalRegistry`), e importar o core
// não pode ter side effect (ADR 0004). Por isso tudo passa por métodos do próprio schema
// (`meta()`, `toJSONSchema()`), que já vêm do Zod que o plugin carregou.

import type { z } from 'zod';

/** Texto que substitui um valor secreto em qualquer exibição (dashboard, `describe`). */
export const SECRET_MASK = '********';

interface Def {
  readonly type: string;
  readonly innerType?: z.ZodType;
  readonly in?: z.ZodType;
  readonly shape?: Readonly<Record<string, z.ZodType>>;
  readonly values?: readonly unknown[];
}

// Embrulhos que não mudam o formato do valor de entrada.
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'catch',
  'nonoptional',
]);

const defOf = (schema: z.ZodType): Def => schema._zod.def as unknown as Def;

/** Próximo nível do embrulho, ou `undefined` se `schema` já é o tipo base. */
function innerOf(schema: z.ZodType): z.ZodType | undefined {
  const def = defOf(schema);
  if (WRAPPERS.has(def.type)) return def.innerType;
  // Num pipe (transform, coerce), a entrada é o lado `in`.
  if (def.type === 'pipe') return def.in;
  return undefined;
}

/** O schema base atrás de optional/default/nullable/pipe. */
export function unwrapSchema(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let inner = innerOf(current); inner; inner = innerOf(current)) current = inner;
  return current;
}

/** Tipo base do schema (`'string'`, `'number'`, `'object'`...). */
export const baseType = (schema: z.ZodType): string => defOf(unwrapSchema(schema)).type;

/** Valores aceitos por um `z.literal` (vazio para outros tipos). */
export const literalValues = (schema: z.ZodType): readonly unknown[] =>
  defOf(unwrapSchema(schema)).values ?? [];

/** Campos do objeto, se o schema base for `z.object`. */
export function objectShape(schema: z.ZodType): Readonly<Record<string, z.ZodType>> | undefined {
  const def = defOf(unwrapSchema(schema));
  return def.type === 'object' ? def.shape : undefined;
}

/**
 * Marca um campo como secreto: o valor é censurado no log, mascarado em `describe` e o JSON
 * Schema exportado sai com `secret: true` e `writeOnly: true`. Vale em qualquer nível de objeto
 * e sobrevive a `.optional()`/`.default()` aplicados depois.
 *
 * ```ts
 * config: z.object({ apiKey: secret(z.string().min(1)) })
 * ```
 */
export function secret<T extends z.ZodType>(schema: T): T {
  // `meta` clona e registra no registro global do Zod, que o `toJSONSchema` lê; a descrição e
  // outros metadados do schema original são herdados pelo clone.
  return schema.meta({ secret: true, writeOnly: true }) as T;
}

// Os `checks` (`.min()`, `.refine()`) também têm `_zod`, mas não são schemas: não têm `meta`.
const isSchema = (value: unknown): value is z.ZodType =>
  typeof value === 'object' &&
  value !== null &&
  '_zod' in value &&
  typeof (value as { meta?: unknown }).meta === 'function';

/** Sub-schemas guardados na definição (`element`, `options`, `keyType`, `items`...). */
function childrenOf(def: Def): z.ZodType[] {
  const children: z.ZodType[] = [];
  for (const value of Object.values(def)) {
    if (isSchema(value)) children.push(value);
    else if (Array.isArray(value)) children.push(...value.filter(isSchema));
  }
  return children;
}

/**
 * Caminhos de `secret()` fora de campo de `z.object` (dentro de array, record, union...). A config
 * só acha segredo seguindo objetos — para censurar no log, mascarar e recusar no override —, então
 * um segredo noutro lugar passaria sem nenhuma dessas proteções. `[*]` marca o nível que não é
 * objeto. `z.lazy` não é percorrido.
 */
export function misplacedSecrets(schema: z.ZodType): string[] {
  const found: string[] = [];
  const visited = new Set<z.ZodType>();
  const walk = (node: z.ZodType, path: string, nested: boolean): void => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node.meta()?.['secret'] === true) {
      // Num campo de objeto, o valor inteiro é segredo: o que houver dentro já está coberto.
      if (nested) found.push(path);
      return;
    }
    const def = defOf(node);
    if (def.type === 'object') {
      for (const [key, field] of Object.entries(def.shape ?? {})) {
        walk(field, path === '' ? key : `${path}.${key}`, nested);
      }
      return;
    }
    // Embrulhos e pipes não mudam o nível; qualquer outro contêiner tira do caminho de objetos.
    const transparent = WRAPPERS.has(def.type) || def.type === 'pipe';
    for (const child of childrenOf(def)) {
      walk(child, transparent ? path : `${path}[*]`, nested || !transparent);
    }
  };
  walk(schema, '', false);
  return found;
}

/** `true` se o campo foi marcado com `secret()` (em qualquer nível do embrulho). */
export function isSecretSchema(schema: z.ZodType): boolean {
  for (let current: z.ZodType | undefined = schema; current; current = innerOf(current)) {
    if (current.meta()?.['secret'] === true) return true;
  }
  return false;
}
