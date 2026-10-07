// Camada de variáveis de ambiente da config de plugin. Este é o único lugar do core que lê
// `process.env` (regra do Biome), e só como padrão quando quem cria a config não injeta um
// ambiente — testes sempre injetam.

import type { z } from 'zod';
import { baseType, literalValues, objectShape } from './schema.ts';

/** Ambiente consultado: nome → valor. `process.env` tem esse formato. */
export type ConfigEnv = Readonly<Record<string, string | undefined>>;

const ENV_PREFIX = 'ZAPFORGE';

/** O ambiente do processo. Lido na chamada, nunca no import. */
export const processEnv = (): ConfigEnv => process.env;

/** `apiKey` → `API_KEY`, `user-names` → `USER_NAMES`, `openAIKey` → `OPEN_AI_KEY`. */
export function toEnvSegment(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toUpperCase();
}

/**
 * Nome da variável de um campo: `ZAPFORGE_<PLUGIN>__<CAMPO>[__<SUBCAMPO>...]`. O `__` separa
 * níveis, então `user-names` + `apiKey` vira `ZAPFORGE_USER_NAMES__API_KEY`.
 */
export function envName(plugin: string, path: readonly string[]): string {
  return [`${ENV_PREFIX}_${toEnvSegment(plugin)}`, ...path.map(toEnvSegment)].join('__');
}

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

/**
 * Converte o texto da variável para o tipo que o schema espera. Se não der, devolve o texto
 * como veio: o Zod rejeita com a mensagem dele e o erro aponta a variável como fonte.
 */
export function coerceEnvValue(raw: string, schema: z.ZodType): unknown {
  switch (baseType(schema)) {
    case 'string':
    case 'enum':
    case 'template_literal':
      return raw;
    case 'number': {
      const value = Number(raw);
      return raw.trim() === '' || Number.isNaN(value) ? raw : value;
    }
    case 'boolean': {
      const lower = raw.trim().toLowerCase();
      if (TRUE.has(lower)) return true;
      if (FALSE.has(lower)) return false;
      return raw;
    }
    case 'literal':
      return literalValues(schema).find((value) => String(value) === raw) ?? raw;
    default:
      // Arrays, records, uniões: a variável traz JSON (`["a","b"]`). Texto que não é JSON
      // segue cru, e o Zod decide se uma string serve.
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
  }
}

/** Um valor lido do ambiente: caminho no objeto de config e a variável de onde veio. */
export interface EnvEntry {
  readonly path: readonly string[];
  readonly name: string;
  readonly value: unknown;
}

/**
 * Valores do ambiente para os campos do schema, percorrendo objetos aninhados. Só campos
 * declarados no schema são procurados — o ambiente não cria chave nova.
 */
export function readEnvFields(
  plugin: string,
  shape: Readonly<Record<string, z.ZodType>>,
  env: ConfigEnv,
  prefix: readonly string[] = [],
): EnvEntry[] {
  const found: EnvEntry[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const path = [...prefix, key];
    const nested = objectShape(field);
    if (nested) {
      found.push(...readEnvFields(plugin, nested, env, path));
      continue;
    }
    const name = envName(plugin, path);
    const raw = env[name];
    if (raw !== undefined) found.push({ path, name, value: coerceEnvValue(raw, field) });
  }
  return found;
}
