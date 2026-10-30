// Lógica pura da tela IA: a cadeia de modelos, o estado em palavra e o corpo do PUT. Sem React,
// para testar sem montar a tela.

import type { paths } from '#lib/api-types.d.ts';

export interface ChainItem {
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
}

/** Faixa de temperatura que vale quando o provedor não declara a dele (o schema vai a 2). */
export const DEFAULT_TEMPERATURE = { min: 0, max: 2 } as const;

/** Saídas máximas prontas; `undefined` é o padrão do provedor. */
export const OUTPUT_PRESETS = [undefined, 512, 1024, 2048, 4096, 8192] as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Lê `models` de uma config que a API devolve como `unknown`; item torto é descartado. */
export function parseChain(value: unknown): ChainItem[] {
  if (!Array.isArray(value)) return [];
  const items: ChainItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw['model'] !== 'string') continue;
    const temperature = raw['temperature'];
    const maxOutputTokens = raw['maxOutputTokens'];
    items.push({
      model: raw['model'],
      ...(typeof temperature === 'number' && { temperature }),
      ...(typeof maxOutputTokens === 'number' && { maxOutputTokens }),
    });
  }
  return items;
}

/** `google:gemini-2.5-flash` vira o provedor e o id; o id pode ter `:`, o provedor não. */
export function splitModel(item: string): { provider: string; id: string } {
  const sep = item.indexOf(':');
  return sep < 0
    ? { provider: '', id: item }
    : { provider: item.slice(0, sep), id: item.slice(sep + 1) };
}

export const joinModel = (provider: string, id: string): string => `${provider}:${id}`;

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

export const removeAt = <T>(items: readonly T[], index: number): T[] =>
  items.filter((_, i) => i !== index);

export function replaceAt(
  items: readonly ChainItem[],
  index: number,
  item: ChainItem,
): ChainItem[] {
  return items.map((current, i) => (i === index ? item : current));
}

export interface TemperatureRange {
  readonly min: number;
  readonly max: number;
}

/** Temperatura dentro da faixa; `undefined` (padrão do provedor) continua assim. */
export function clampTemperature(
  value: number | undefined,
  range: TemperatureRange,
): number | undefined {
  if (value === undefined) return undefined;
  return Math.min(range.max, Math.max(range.min, value));
}

/** Monta o item sem `undefined` explícito: parâmetro vazio sai do corpo. */
export function makeItem(model: string, temperature?: number, maxOutputTokens?: number): ChainItem {
  return {
    model,
    ...(temperature !== undefined && { temperature }),
    ...(maxOutputTokens !== undefined && { maxOutputTokens }),
  };
}

/**
 * Troca de provedor: o modelo passa a ser o primeiro do novo e a temperatura é limitada ao máximo
 * dele (a escala muda: o Gemini vai a 2, o Claude a 1).
 */
export function changeProvider(
  item: ChainItem,
  provider: string,
  firstModel: string,
  range: TemperatureRange,
): ChainItem {
  return makeItem(
    joinModel(provider, firstModel),
    clampTemperature(item.temperature, range),
    item.maxOutputTokens,
  );
}

export const withModel = (item: ChainItem, model: string): ChainItem =>
  makeItem(model, item.temperature, item.maxOutputTokens);

export const withTemperature = (item: ChainItem, temperature: number | undefined): ChainItem =>
  makeItem(item.model, temperature, item.maxOutputTokens);

export const withMaxOutput = (item: ChainItem, maxOutputTokens: number | undefined): ChainItem =>
  makeItem(item.model, item.temperature, maxOutputTokens);

const normalize = (item: ChainItem) => [
  item.model,
  item.temperature ?? null,
  item.maxOutputTokens ?? null,
];

export function sameChain(a: readonly ChainItem[], b: readonly ChainItem[]): boolean {
  return JSON.stringify(a.map(normalize)) === JSON.stringify(b.map(normalize));
}

export type ModelStatus =
  paths['/api/plugins/ai/status']['get']['responses'][200]['content']['application/json']['models'][number];

export type Tone = 'ok' | 'warn' | 'danger';

/** O estado de uma posição em palavra: o que muda o comportamento da cadeia. */
export function stateWord(
  status: ModelStatus | undefined,
  knownProvider: boolean,
  now: number,
): { tone: Tone; text: string } | null {
  if (status === undefined) return null;
  if (status.state === 'unregistered') {
    return { tone: 'danger', text: knownProvider ? 'pulado, sem chave' : 'pulado, sem provedor' };
  }
  if (status.state === 'cooldown') {
    const seconds = Math.max(1, Math.ceil((Date.parse(status.until ?? '') - now) / 1000) || 1);
    return { tone: 'warn', text: `em espera, ${seconds} s` };
  }
  return { tone: 'ok', text: 'pronto' };
}

/**
 * `apiKey` vira `API_KEY`, `user-names` vira `USER_NAMES`. Cópia do `toEnvSegment` do core até a
 * API devolver o nome da variável (issue 317 do usebridger).
 */
const envSegment = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replaceAll('-', '_')
    .toUpperCase();

/** Variável de ambiente de um campo: `BRIDGER_<PLUGIN>__<CAMPO>[__<SUBCAMPO>]`. */
export const envName = (plugin: string, path: readonly string[]): string =>
  [`BRIDGER_${envSegment(plugin)}`, ...path.map(envSegment)].join('__');

export const keyEnvName = (provider: string): string => envName('ai', ['keys', provider]);

export type Sources = Readonly<Record<string, string>>;

/**
 * Por que o campo não é editável aqui: "definido por <variável>" ou "definido pelo arquivo" quando
 * a fonte dele (ou de um subcampo) é env ou arquivo; `null` quando o override vale.
 */
export function lockedLabel(plugin: string, sources: Sources, path: string): string | null {
  const source = lockedSource(sources, path);
  if (source === 'env') return `definido por ${envName(plugin, path.split('.'))}`;
  if (source === 'file') return 'definido pelo arquivo de config';
  return null;
}

/** A fonte que trava o campo (ou um subcampo): variável de ambiente ou arquivo. */
export function lockedSource(sources: Sources, path: string): 'env' | 'file' | null {
  for (const [key, source] of Object.entries(sources)) {
    if (key !== path && !key.startsWith(`${path}.`)) continue;
    if (source === 'env' || source === 'file') return source;
  }
  return null;
}

/** O schema da config declara a chave do provedor (`keys.properties.<id>`)? */
export function schemaHasKey(schema: unknown, provider: string): boolean {
  if (!isRecord(schema) || !isRecord(schema['properties'])) return false;
  const keys = schema['properties']['keys'];
  return isRecord(keys) && isRecord(keys['properties']) && provider in keys['properties'];
}

/** Overrides de uma config vista pela API; as mensagens vêm à parte e também são override. */
export function viewOverrides(view: {
  config: unknown;
  messages: Record<string, string>;
  sources: Sources;
}): Record<string, unknown> {
  const config = isRecord(view.config) ? view.config : {};
  return overridesOf({ ...config, messages: view.messages }, view.sources);
}

/**
 * Só o que veio de override: a config que a API devolve é a efetiva (padrão, arquivo, env e
 * override juntos). O PUT substitui os overrides, então regravar o que não era override o
 * fixaria e o campo deixaria de seguir o padrão. Override sombreado por env ou arquivo tem fonte
 * `env`/`file`, não `override`: é descartado do corpo (já não valia e o PUT o apagaria).
 */
export function overridesOf(config: unknown, sources: Sources): Record<string, unknown> {
  const overridden = Object.entries(sources)
    .filter(([, source]) => source === 'override')
    .map(([path]) => path);
  const has = (path: string) => overridden.some((p) => p === path || p.startsWith(`${path}.`));
  const pick = (value: unknown, path: string): unknown => {
    if (!has(path)) return undefined;
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const picked = pick(child, `${path}.${key}`);
      if (picked !== undefined) out[key] = picked;
    }
    return out;
  };
  if (!isRecord(config)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const picked = pick(value, key);
    if (picked !== undefined) out[key] = picked;
  }
  return out;
}

export interface AiDraft {
  readonly chain: readonly ChainItem[];
  readonly timeoutMs: number;
  readonly cooldownMs: number;
  readonly maxToolSteps: number;
  /** Chaves digitadas por provedor; vazio não entra no corpo. */
  readonly keys: Readonly<Record<string, string>>;
}

/** Corpo do PUT de `/api/plugins/ai/config`: overrides de antes mais o que mudou. */
export function buildAiBody(
  overrides: Record<string, unknown>,
  base: AiDraft,
  draft: AiDraft,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...overrides };
  if (!sameChain(base.chain, draft.chain) || 'models' in overrides) body['models'] = draft.chain;
  for (const field of ['timeoutMs', 'cooldownMs', 'maxToolSteps'] as const) {
    if (base[field] !== draft[field] || field in overrides) body[field] = draft[field];
  }
  const keys = Object.fromEntries(Object.entries(draft.keys).filter(([, v]) => v !== ''));
  if (Object.keys(keys).length > 0) body['keys'] = keys;
  return body;
}

/** Corpo do PUT de um plugin: `models` próprio, ou fora do corpo para voltar à ordem principal. */
export function buildResourceBody(
  overrides: Record<string, unknown>,
  own: readonly ChainItem[] | null,
): Record<string, unknown> {
  const body = { ...overrides };
  delete body['models'];
  // Cadeia própria vazia (a principal estava vazia ao escolher "Própria") é a ordem principal.
  if (own !== null && own.length > 0) body['models'] = own;
  return body;
}

/** `"models.1.temperature"` vira índice 1 e campo; outro caminho vira `null`. */
export function chainErrorTarget(path: string): { index: number; field: string } | null {
  const match = /^models\.(\d+)(?:\.(.+))?$/.exec(path);
  if (!match) return null;
  return { index: Number(match[1]), field: match[2] ?? '' };
}

/** Segundos digitados em ms; vazio, negativo ou texto dão `null`. */
export function secondsToMs(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
}

export const msToSeconds = (ms: number): string => String(ms / 1000).replace('.', ',');

/** Cadeia própria vazia vale como ordem principal (`null`). */
export const normalizeOwn = (own: readonly ChainItem[] | null): readonly ChainItem[] | null =>
  own !== null && own.length > 0 ? own : null;
