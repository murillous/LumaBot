// Config por plugin (M1-13, ADRs 0017 e 0025). Junta as camadas — default do schema < override
// salvo no storage (dashboard) < arquivo (config do app) < env —, valida com o schema Zod do
// plugin, mescla os `messages` sobrescritos e mantém os valores secretos no `SecretSet` que o
// logger consulta. Quem monta o `PluginContext` (M1-16) chama `resolve` a cada setup; uma
// mudança de override é validada antes de salvar e dispara o reload do plugin. Campo `secret` não
// entra por override: o storage guarda em texto puro (ADR 0032).

import type { z } from 'zod';
import { createNoopLogger } from '#logger/logger.ts';
import type { SecretSet } from '#logger/secrets.ts';
import type { Logger } from '#logger/types.ts';
import type { PluginReloadResult } from '#plugin/host.ts';
import type { PluginDefinition, PluginMessages } from '#plugin/types.ts';
import { kernelStorage } from '#storage/namespace.ts';
import type { JsonObject, StoragePort } from '#storage/types.ts';
import { type ConfigEnv, type EnvEntry, envName, processEnv, readEnvFields } from './env.ts';
import { type ConfigSource, PluginConfigError, type PluginConfigIssue } from './errors.ts';
import { isSecretSchema, objectShape, SECRET_MASK } from './schema.ts';

/**
 * Config de um plugin vinda do app ou do storage: os campos do schema e, opcionalmente,
 * `messages` com textos a sobrescrever (ADR 0025). `messages` é chave reservada.
 */
export type PluginConfigEntry = Readonly<Record<string, unknown>>;

/** "Arquivo" de config: nome do plugin → entrada. É o `pluginConfig` da config do bot. */
export type PluginConfigFile = Readonly<Record<string, PluginConfigEntry>>;

/** O que o contexto do plugin recebe: `ctx.config` e `ctx.plugin.messages`. */
export interface ResolvedPluginConfig {
  /** Saída do schema (defaults aplicados); `undefined` se o plugin não declara `config`. */
  readonly config: unknown;
  /** `messages` do manifesto com as sobrescritas aplicadas. */
  readonly messages: PluginMessages;
}

/** Config para exibição (dashboard, diagnóstico): campos `secret` trocados por `SECRET_MASK`. */
export interface PluginConfigView {
  readonly config: unknown;
  readonly messages: PluginMessages;
}

/**
 * JSON Schema (draft 2020-12) da entrada da config; campos secretos com `secret: true`,
 * `writeOnly: true` e `x-zapforge-override: false` (não editáveis por override).
 */
export type PluginConfigJsonSchema = Readonly<Record<string, unknown>>;

export interface PluginConfigsOptions {
  /** Plugins conhecidos (os mesmos passados ao host). */
  readonly plugins: readonly PluginDefinition[];
  /** Config do app por plugin. */
  readonly file?: PluginConfigFile;
  /** Overrides ficam em `kernelStorage(storage, 'config').kv`, chave = nome do plugin. */
  readonly storage: StoragePort;
  /** Ambiente lido. Padrão: `process.env` (testes injetam o seu). */
  readonly env?: ConfigEnv;
  /** Recebe os valores dos campos `secret` de cada plugin resolvido (compartilhe com o logger). */
  readonly secrets?: SecretSet;
  /** Chamado depois de salvar um override válido; normalmente `(name) => host.reload(name)`. */
  readonly reload?: (plugin: string) => Promise<PluginReloadResult>;
  /** Avisos de configuração (ex.: `pluginConfig` citando plugin inexistente). */
  readonly log?: Logger;
}

export interface PluginConfigs {
  /**
   * Config atual do plugin, validada, e `messages` mesclado. Lança `PluginConfigError` se
   * alguma camada tiver valor inválido. Registra os segredos no `SecretSet`.
   */
  resolve(plugin: string): Promise<ResolvedPluginConfig>;
  /**
   * Substitui os overrides do plugin (`{}` remove). Campo `secret` (em qualquer nível) é
   * recusado com `PluginConfigError` (fonte `override`): segredo vem de env ou do arquivo.
   * Valida a config resultante antes de salvar:
   * se inválida, rejeita com `PluginConfigError` e nada muda — o plugin segue rodando. Se
   * válida, salva e chama `reload` (devolve o resultado dele; `undefined` sem `reload`).
   */
  setOverrides(plugin: string, overrides: JsonObject): Promise<PluginReloadResult | undefined>;
  /** Config atual com os segredos mascarados. Lança `PluginConfigError` se inválida. */
  describe(plugin: string): Promise<PluginConfigView>;
  /** JSON Schema da config para gerar formulário; `undefined` se o plugin não declara `config`. */
  jsonSchema(plugin: string): PluginConfigJsonSchema | undefined;
}

const MESSAGES_KEY = 'messages';
const SECRETS_OWNER = (plugin: string): string => `plugin:${plugin}`;

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** `top` sobre `base`: objetos mesclam recursivamente; o resto (arrays inclusive) substitui. */
function deepMerge(base: PlainObject, top: PlainObject): PlainObject {
  const merged: PlainObject = { ...base };
  for (const [key, value] of Object.entries(top)) {
    // `undefined` é ausência: não apaga o que veio de camada mais baixa.
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] =
      isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

function setIn(target: PlainObject, path: readonly string[], value: unknown): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (isPlainObject(next)) node = next;
    else {
      const created: PlainObject = {};
      node[key] = created;
      node = created;
    }
  }
  node[path.at(-1) as string] = value;
}

/** `true` se a camada forneceu algum valor no caminho. */
function provides(layer: PlainObject, path: readonly PropertyKey[]): boolean {
  let node: unknown = layer;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return true;
    if (!(key in node)) return false;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node !== undefined;
}

const startsWith = (path: readonly PropertyKey[], prefix: readonly string[]): boolean =>
  prefix.every((key, index) => String(path[index]) === key);

/**
 * Copia `value` trocando cada campo `secret` por `onSecret(valor)`. Percorre só objetos
 * declarados no schema; o que o schema não descreve passa intacto.
 */
function mapSecrets(
  schema: z.ZodType,
  value: unknown,
  onSecret: (value: unknown) => unknown,
): unknown {
  const shape = objectShape(schema);
  if (!shape || !isPlainObject(value)) return value;
  const copy: PlainObject = { ...value };
  for (const [key, field] of Object.entries(shape)) {
    if (copy[key] === undefined) continue;
    copy[key] = isSecretSchema(field)
      ? onSecret(copy[key])
      : mapSecrets(field, copy[key], onSecret);
  }
  return copy;
}

/**
 * Caminhos dos campos `secret` presentes em `value`, seguindo o schema. Mesmo critério de
 * `mapSecrets`: só objetos declarados; `undefined` é ausência.
 */
function secretPaths(
  schema: z.ZodType,
  value: unknown,
  prefix: readonly string[] = [],
): string[][] {
  const shape = objectShape(schema);
  if (!shape || !isPlainObject(value)) return [];
  return Object.entries(shape).flatMap(([key, field]) => {
    if (value[key] === undefined) return [];
    const path = [...prefix, key];
    return isSecretSchema(field) ? [path] : secretPaths(field, value[key], path);
  });
}

/** Cópia de `value` sem o campo em `path` (os objetos do caminho são copiados, não alterados). */
function withoutPath(value: PlainObject, path: readonly string[]): PlainObject {
  const [key, ...rest] = path as [string, ...string[]];
  const copy: PlainObject = { ...value };
  const next = copy[key];
  if (rest.length === 0) delete copy[key];
  else if (isPlainObject(next)) copy[key] = withoutPath(next, rest);
  return copy;
}

/** Valores de um campo secreto como texto, para o logger achá-los na linha. */
function secretStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (typeof value === 'number' || typeof value === 'bigint') into.push(String(value));
  else if (Array.isArray(value)) for (const item of value) secretStrings(item, into);
  else if (isPlainObject(value)) for (const item of Object.values(value)) secretStrings(item, into);
}

/** Anotação do JSON Schema que diz ao dashboard que o campo não aceita override. */
const OVERRIDE_ANNOTATION = 'x-zapforge-override';

/**
 * No JSON Schema exportado, marca campo secreto como não editável por override e troca o
 * `default` dele pela máscara. `x-zapforge-override` em vez de `readOnly`: o campo já é
 * `writeOnly`, e `readOnly` + `writeOnly` juntos se contradizem no JSON Schema.
 */
function markSecrets(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) markSecrets(item);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as PlainObject;
  if (record['secret'] === true) {
    record[OVERRIDE_ANNOTATION] = false;
    if ('default' in record) record['default'] = SECRET_MASK;
  }
  for (const value of Object.values(record)) markSecrets(value);
}

interface Layer {
  readonly source: Exclude<ConfigSource, 'default' | 'env'>;
  readonly fields: PlainObject;
  readonly messages: PlainObject;
}

type Computed =
  | { ok: true; resolved: ResolvedPluginConfig; secrets: string[] }
  | { ok: false; error: PluginConfigError };

/** Cria a config dos plugins. Não lê storage nem ambiente até a primeira chamada. */
export function createPluginConfigs(options: PluginConfigsOptions): PluginConfigs {
  const env = options.env ?? processEnv();
  const kv = kernelStorage(options.storage, 'config').kv;
  const log = options.log ?? createNoopLogger();
  const file = options.file ?? {};
  const byName = new Map(options.plugins.map((plugin) => [plugin.name, plugin]));

  for (const name of Object.keys(file)) {
    if (!byName.has(name)) {
      log.warn(`pluginConfig cita "${name}", que não existe entre os plugins`, { plugin: name });
    }
  }

  let queue: Promise<unknown> = Promise.resolve();
  // Avisa uma vez por campo: `resolve` roda a cada setup/reload/describe.
  const warnedLegacy = new Set<string>();

  function definitionOf(name: string): PluginDefinition {
    const definition = byName.get(name);
    if (!definition) throw new RangeError(`config: plugin desconhecido "${name}"`);
    return definition;
  }

  /** Separa campos e `messages` de uma entrada; formato errado vira problema da fonte. */
  function toLayer(
    source: Layer['source'],
    raw: unknown,
    issues: PluginConfigIssue[],
  ): Layer | undefined {
    if (raw === undefined) return undefined;
    if (!isPlainObject(raw)) {
      issues.push({ path: '', message: 'a config do plugin deve ser um objeto', source });
      return undefined;
    }
    const { [MESSAGES_KEY]: messages, ...fields } = raw;
    if (messages !== undefined && !isPlainObject(messages)) {
      issues.push({ path: MESSAGES_KEY, message: 'deve ser um objeto chave → texto', source });
      return { source, fields, messages: {} };
    }
    return { source, fields, messages: messages ?? {} };
  }

  function compute(definition: PluginDefinition, override: unknown): Computed {
    const { name } = definition;
    const schema = definition.config;
    const shape = schema ? objectShape(schema) : undefined;
    // Erros do autor do plugin, não da config: mensagem direta, sem fonte.
    if (schema && !shape) {
      throw new TypeError(`plugin "${name}": o schema de config deve ser um z.object(...)`);
    }
    if (shape && MESSAGES_KEY in shape) {
      throw new TypeError(
        `plugin "${name}": "${MESSAGES_KEY}" é reservado para sobrescrever textos (ADR 0025) ` +
          'e não pode ser campo do schema de config',
      );
    }

    const issues: PluginConfigIssue[] = [];
    // Da menor para a maior precedência.
    const layers = [
      toLayer('override', override, issues),
      toLayer('file', file[name], issues),
    ].filter((layer) => layer !== undefined);
    const envFields = shape ? readEnvFields(name, shape, env) : [];
    const envMessages: EnvEntry[] = Object.keys(definition.messages ?? {}).flatMap((key) => {
      const variable = envName(name, [MESSAGES_KEY, key]);
      const value = env[variable];
      return value === undefined ? [] : [{ path: [key], name: variable, value }];
    });

    let fields: PlainObject = {};
    for (const layer of layers) fields = deepMerge(fields, layer.fields);
    const envLayer: PlainObject = {};
    for (const entry of envFields) setIn(envLayer, entry.path, entry.value);
    fields = deepMerge(fields, envLayer);

    const sourceOf = (path: readonly PropertyKey[]): Omit<PluginConfigIssue, 'message'> => {
      const label = path.map(String).join('.');
      const fromEnv = envFields.find((entry) => startsWith(path, entry.path));
      if (fromEnv) return { path: label, source: 'env', env: fromEnv.name };
      for (const layer of layers.toReversed()) {
        if (provides(layer.fields, path)) return { path: label, source: layer.source };
      }
      return { path: label, source: 'default' };
    };

    let config: unknown;
    if (!schema) {
      for (const layer of layers) {
        for (const key of Object.keys(layer.fields)) {
          issues.push({
            path: key,
            message: 'o plugin não declara config; o campo não tem para onde ir',
            source: layer.source,
          });
        }
      }
    } else {
      const parsed = schema.safeParse(fields);
      if (parsed.success) config = parsed.data;
      else {
        // Só a mensagem do Zod: ela não inclui o valor recebido, que pode ser secreto.
        for (const issue of parsed.error.issues) {
          issues.push({ ...sourceOf(issue.path), message: issue.message });
        }
      }
    }

    const base = definition.messages ?? {};
    const messages: Record<string, string> = { ...base };
    const messageLayers = [
      ...layers.map((layer) => ({
        entries: Object.entries(layer.messages),
        sourceOf: (): Omit<PluginConfigIssue, 'message' | 'path'> => ({ source: layer.source }),
      })),
      {
        entries: envMessages.map((entry) => [entry.path[0] as string, entry.value] as const),
        sourceOf: (key: string): Omit<PluginConfigIssue, 'message' | 'path'> => ({
          source: 'env',
          env: envName(name, [MESSAGES_KEY, key]),
        }),
      },
    ];
    for (const layer of messageLayers) {
      for (const [key, text] of layer.entries) {
        const at = { path: `${MESSAGES_KEY}.${key}`, ...layer.sourceOf(key) };
        if (!Object.hasOwn(base, key)) {
          const known = Object.keys(base);
          issues.push({
            ...at,
            message:
              `mensagem desconhecida; o plugin declara ` +
              (known.length === 0 ? 'nenhuma' : known.map((k) => `"${k}"`).join(', ')),
          });
        } else if (typeof text !== 'string') {
          issues.push({ ...at, message: 'deve ser texto' });
        } else messages[key] = text;
      }
    }

    if (issues.length > 0) return { ok: false, error: new PluginConfigError(name, issues) };
    const secrets: string[] = [];
    if (schema) {
      mapSecrets(schema, config, (value) => {
        secretStrings(value, secrets);
        return value;
      });
    }
    return { ok: true, resolved: { config, messages: Object.freeze(messages) }, secrets };
  }

  /**
   * Override salvo antes da regra de segredos (ou escrito direto no banco) pode ter campo
   * `secret`. O valor é ignorado com aviso em vez de falhar a config: um dado legado não deve
   * desligar o plugin, e o segredo de verdade continua vindo de env ou do arquivo.
   */
  function dropLegacySecrets(definition: PluginDefinition, stored: unknown): unknown {
    if (!definition.config || !isPlainObject(stored)) return stored;
    let clean = stored;
    for (const path of secretPaths(definition.config, stored)) {
      clean = withoutPath(clean, path);
      const label = path.join('.');
      const key = `${definition.name}:${label}`;
      if (warnedLegacy.has(key)) continue;
      warnedLegacy.add(key);
      // Só o caminho: o valor é segredo e ainda não está no `SecretSet`.
      log.warn(
        `override do plugin "${definition.name}" tem o campo secreto "${label}", ignorado; ` +
          `defina pela env ${envName(definition.name, path)} ou pelo arquivo`,
        { plugin: definition.name, field: label },
      );
    }
    return clean;
  }

  async function current(name: string): Promise<ResolvedPluginConfig> {
    const definition = definitionOf(name);
    const result = compute(definition, dropLegacySecrets(definition, await kv.get(name)));
    if (!result.ok) throw result.error;
    options.secrets?.set(SECRETS_OWNER(name), result.secrets);
    return result.resolved;
  }

  async function runSetOverrides(
    name: string,
    overrides: JsonObject,
  ): Promise<PluginReloadResult | undefined> {
    const definition = definitionOf(name);
    // O storage guarda o override em texto puro (banco, backups): segredo não entra (ADR 0032).
    const secretIssues: PluginConfigIssue[] = definition.config
      ? secretPaths(definition.config, overrides).map((path) => ({
          path: path.join('.'),
          message:
            'campo secreto não pode ser definido por override (o storage guarda em texto ' +
            `puro); defina pela env ${envName(name, path)} ou pelo arquivo ` +
            `pluginConfig["${name}"].${path.join('.')}`,
          source: 'override',
        }))
      : [];
    if (secretIssues.length > 0) throw new PluginConfigError(name, secretIssues);
    const result = compute(definition, overrides);
    if (!result.ok) throw result.error;
    // Antes de salvar e de recarregar: o reload loga, e o segredo novo já precisa sair censurado.
    options.secrets?.set(SECRETS_OWNER(name), result.secrets);
    if (Object.keys(overrides).length === 0) await kv.delete(name);
    else await kv.set(name, overrides);
    return options.reload ? options.reload(name) : undefined;
  }

  return {
    resolve: current,

    setOverrides(name: string, overrides: JsonObject): Promise<PluginReloadResult | undefined> {
      // Uma mudança por vez: duas gravações concorrentes reordenariam save e reload.
      const result = queue.then(() => runSetOverrides(name, overrides));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    async describe(name: string): Promise<PluginConfigView> {
      const definition = definitionOf(name);
      const { config, messages } = await current(name);
      const masked = definition.config
        ? mapSecrets(definition.config, config, () => SECRET_MASK)
        : config;
      return { config: masked, messages };
    },

    jsonSchema(name: string): PluginConfigJsonSchema | undefined {
      const schema = definitionOf(name).config;
      if (!schema) return undefined;
      // `input`: o formulário preenche a entrada (campos com default são opcionais). Transform
      // não tem JSON Schema; vira `{}` em vez de lançar.
      const json = schema.toJSONSchema({ io: 'input', unrepresentable: 'any' });
      markSecrets(json);
      return json as PluginConfigJsonSchema;
    },
  };
}
