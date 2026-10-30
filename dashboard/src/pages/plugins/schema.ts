// Gerador do formulário de config: tudo aqui é função pura (JSON Schema -> controle), para o mapa
// do guia (DESIGN.md, Plugins) ser testado sem montar tela.

export type Json = Record<string, unknown>;

/** Máscara que o core devolve no lugar do segredo; enviada de volta, mantém o valor salvo. */
export const MASK = '********';

/** Até quantos passos um slider aguenta antes de virar campo numérico. */
export const MAX_SLIDER_STEPS = 200;
/** Segmentado vai até aqui; enum maior vira `select`. */
export const MAX_SEGMENTED = 4;

export type Control =
  | { kind: 'slider'; min: number; max: number; step: number }
  | { kind: 'number'; integer: boolean; min?: number; max?: number; unit?: string }
  | { kind: 'segmented'; options: readonly string[] }
  | { kind: 'select'; options: readonly string[] }
  | { kind: 'toggle' }
  | { kind: 'tags' }
  | { kind: 'color' }
  | { kind: 'secret' }
  | { kind: 'models' }
  | { kind: 'text' }
  // Tipo que o gerador não edita (objeto livre, array de objetos): mostra o valor e o preserva.
  | { kind: 'json' };

export interface Leaf {
  type: 'field';
  path: string;
  label: string;
  help?: string;
  control: Control;
  placeholder?: string;
}

export interface Branch {
  type: 'group';
  path: string;
  label: string;
  children: readonly Node[];
}

export type Node = Leaf | Branch;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `anyOf: [X, null]` (campo opcional/anulável) vira o próprio X. */
export function normalize(schema: Json): Json {
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = schema[key];
    if (!Array.isArray(options)) continue;
    const real = options.filter((o): o is Json => isObject(o) && o['type'] !== 'null');
    if (real.length === 1 && real[0] !== undefined) {
      const { [key]: _dropped, ...rest } = schema;
      return normalize({ ...real[0], ...rest });
    }
  }
  const type = schema['type'];
  if (Array.isArray(type)) {
    const real = type.filter((t) => t !== 'null');
    if (real.length === 1) return { ...schema, type: real[0] };
  }
  return schema;
}

const SUFFIX_UNITS: readonly (readonly [RegExp, string])[] = [
  [/Ms$/, 'ms'],
  [/(Seconds|Secs?)$/, 's'],
  [/Minutes$/, 'min'],
  [/Bytes$/, 'bytes'],
  [/Mb$/, 'MB'],
  [/Kb$/, 'KB'],
  [/Px$/, 'px'],
];

/** Unidade do campo numérico, pelo sufixo do nome (`timeoutMs` -> ms); sem sufixo, nenhuma. */
export function unitOf(key: string): string | undefined {
  return SUFFIX_UNITS.find(([pattern]) => pattern.test(key))?.[1];
}

/** O padrão do schema só aceita `#rrggbb`? */
export function isColorPattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string') return false;
  try {
    const re = new RegExp(pattern);
    const hex = (digits: string) => `#${digits}`;
    return (
      re.test(hex('a1b2c3')) && !re.test(hex('xyz123')) && !re.test('a1b2c3') && !re.test('red')
    );
  } catch {
    // Padrão que o JS não entende não é cor: cai no campo de texto.
    return false;
  }
}

/** O mapa schema -> controle do guia, para um campo (nunca um objeto). */
export function controlOf(rawSchema: Json, key: string, path = key): Control {
  const schema = normalize(rawSchema);
  const type = schema['type'];
  if (path === 'models') return { kind: 'models' };
  if (schema['secret'] === true || schema['writeOnly'] === true) return { kind: 'secret' };

  const values = schema['enum'];
  if (Array.isArray(values) && values.length > 0) {
    const options = values.map(String);
    return options.length <= MAX_SEGMENTED
      ? { kind: 'segmented', options }
      : { kind: 'select', options };
  }
  if (type === 'boolean') return { kind: 'toggle' };
  if (type === 'number' || type === 'integer') {
    const integer = type === 'integer';
    const min = typeof schema['minimum'] === 'number' ? schema['minimum'] : undefined;
    const max = typeof schema['maximum'] === 'number' ? schema['maximum'] : undefined;
    if (min !== undefined && max !== undefined && max > min) {
      const declared = schema['multipleOf'];
      const step = typeof declared === 'number' && declared > 0 ? declared : integer ? 1 : 0.1;
      if ((max - min) / step <= MAX_SLIDER_STEPS + 1e-9) return { kind: 'slider', min, max, step };
    }
    const unit = unitOf(key);
    return {
      kind: 'number',
      integer,
      ...(min !== undefined && { min }),
      ...(max !== undefined && { max }),
      ...(unit !== undefined && { unit }),
    };
  }
  if (type === 'array') {
    const items = isObject(schema['items']) ? normalize(schema['items']) : {};
    return items['type'] === 'string' && items['enum'] === undefined
      ? { kind: 'tags' }
      : { kind: 'json' };
  }
  if (type === 'string') {
    return isColorPattern(schema['pattern']) ? { kind: 'color' } : { kind: 'text' };
  }
  return { kind: 'json' };
}

/** Campos do topo que não são do formulário: os textos (`messages`) voltam intactos no `PUT`. */
const NOT_FIELDS = new Set(['messages']);

/** Árvore de campos a partir do `properties` do schema (objetos viram grupos). */
export function nodesOf(rawSchema: Json, prefix = ''): readonly Node[] {
  const properties = normalize(rawSchema)['properties'];
  if (!isObject(properties)) return [];
  const out: Node[] = [];
  for (const [key, child] of Object.entries(properties)) {
    if (!isObject(child)) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (prefix === '' && NOT_FIELDS.has(key)) continue;
    const schema = normalize(child);
    const label = typeof schema['title'] === 'string' ? schema['title'] : key;
    if (schema['type'] === 'object' && isObject(schema['properties'])) {
      const children = nodesOf(schema, path);
      if (children.length > 0) out.push({ type: 'group', path, label, children });
      continue;
    }
    const help = typeof schema['description'] === 'string' ? schema['description'] : undefined;
    const fallback = schema['default'];
    out.push({
      type: 'field',
      path,
      label,
      ...(help !== undefined && { help }),
      control: controlOf(schema, key, path),
      ...(fallback !== undefined &&
        typeof fallback !== 'object' && { placeholder: `padrão: ${String(fallback)}` }),
    });
  }
  return out;
}

export function leavesOf(nodes: readonly Node[]): Leaf[] {
  return nodes.flatMap((n) => (n.type === 'field' ? [n] : leavesOf(n.children)));
}

export function getPath(value: unknown, path: string): unknown {
  let node = value;
  for (const part of path.split('.')) {
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

function setPath(target: Json, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (isObject(next)) node = next;
    else {
      const created: Json = {};
      node[part] = created;
      node = created;
    }
  }
  const last = parts.at(-1);
  if (last !== undefined) node[last] = value;
}

export const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'number' && Number.isNaN(value));

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const snake = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toUpperCase();

/** `BRIDGER_<PLUGIN>__<CAMPO>[__<SUB>]`: a variável que decide o campo (para a ajuda). */
export const envName = (plugin: string, path: string): string =>
  `BRIDGER_${snake(plugin)}__${path.split('.').map(snake).join('__')}`;

/** Quem decide o campo: `env` e `file` ganham do override, então a tela não deixa editar. */
export const isLocked = (source: string | undefined): boolean =>
  source === 'env' || source === 'file';

/**
 * Corpo do `PUT`: os overrides que já existiam (e segredos salvos, pela máscara) mais o que a
 * pessoa mudou. Campo esvaziado sai do corpo; os textos de `messages` com override voltam.
 */
export function buildBody(args: {
  leaves: readonly Leaf[];
  config: unknown;
  sources: Readonly<Record<string, string>>;
  messages: Readonly<Record<string, string>>;
  edits: Readonly<Record<string, unknown>>;
}): Json {
  const { leaves, config, sources, messages, edits } = args;
  const body: Json = {};
  for (const leaf of leaves) {
    const source = sources[leaf.path];
    if (isLocked(source)) continue;
    if (leaf.path in edits) {
      const value = edits[leaf.path];
      if (!isEmpty(value)) setPath(body, leaf.path, value);
    } else if (source === 'override') {
      const value = getPath(config, leaf.path);
      if (!isEmpty(value)) setPath(body, leaf.path, value);
    } else if (source === 'secret') {
      setPath(body, leaf.path, MASK);
    }
  }
  const kept = Object.fromEntries(
    Object.entries(messages).filter(([key]) => sources[`messages.${key}`] === 'override'),
  );
  if (Object.keys(kept).length > 0) body['messages'] = kept;
  return body;
}

/** `errors[].path` do 400 por caminho do campo (primeira mensagem de cada). */
export function errorsByPath(
  errors: readonly { path: string; message: string }[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { path, message } of errors ?? []) out[path] ??= message;
  return out;
}
