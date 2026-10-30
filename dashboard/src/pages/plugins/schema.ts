// Gerador do formulário de config: tudo aqui é função pura (JSON Schema -> controle), para o mapa
// do guia (DESIGN.md, Plugins) ser testado sem montar tela.

export type Json = Record<string, unknown>;

/** Máscara que o core devolve no lugar do segredo; enviada de volta, mantém o valor salvo. */
export const MASK = '********';

/** Até quantos passos um slider aguenta antes de virar campo numérico. */
export const MAX_SLIDER_STEPS = 200;
/** Segmentado vai até aqui; enum maior vira `select`. */
export const MAX_SEGMENTED = 4;

/** Valor do enum como o schema o declara (número continua número ao salvar). */
export type Option = string | number | boolean;

export type Control =
  | { kind: 'slider'; min: number; max: number; step: number }
  | { kind: 'number'; integer: boolean; min?: number; max?: number; unit?: string }
  | { kind: 'segmented'; options: readonly Option[] }
  | { kind: 'select'; options: readonly Option[] }
  | { kind: 'toggle' }
  | { kind: 'tags' }
  | { kind: 'color'; fallback?: string }
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

/** Unidade pelo sufixo do nome (`timeoutMs` -> ms): só o plano B de quando o schema não traz `unit`. */
export function unitOf(key: string): string | undefined {
  return SUFFIX_UNITS.find(([pattern]) => pattern.test(key))?.[1];
}

// O `pattern` de uma cor é sempre o mesmo texto de regex; compará-lo como texto dispensa testar
// com amostra de cor.
const COLOR_PATTERN = /^\^?#\[(?:0-9a-f(?:A-F)?|0-9A-F(?:a-f)?|\\da-f(?:A-F)?)\]\{6\}\$?$/i;

/** O padrão do schema só aceita `#rrggbb`? */
export const isColorPattern = (pattern: unknown): boolean =>
  typeof pattern === 'string' && COLOR_PATTERN.test(pattern);

/** O mapa schema -> controle do guia, para um campo (nunca um objeto). */
export function controlOf(rawSchema: Json, key: string, path = key, unitKey = key): Control {
  const schema = normalize(rawSchema);
  const type = schema['type'];
  if (path === 'models') return { kind: 'models' };
  const items = isObject(schema['items']) ? normalize(schema['items']) : {};
  const itemProps = items['properties'];
  // Cadeia de modelos (`models`, `visionModels`): item com `model`. Quem escolhe é a tela IA.
  if (type === 'array' && isObject(itemProps) && isObject(itemProps['model'])) {
    return { kind: 'models' };
  }
  if (schema['secret'] === true || schema['writeOnly'] === true) return { kind: 'secret' };

  const values = schema['enum'];
  if (Array.isArray(values) && values.length > 0) {
    const options = values.filter((v): v is Option =>
      ['string', 'number', 'boolean'].includes(typeof v),
    );
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
      // Sem `multipleOf`, cem passos: não arredonda valor fino (0,05 em 0 a 1) sem entupir o slider.
      const step =
        typeof declared === 'number' && declared > 0
          ? declared
          : integer
            ? 1
            : Number(((max - min) / 100).toPrecision(6));
      if ((max - min) / step <= MAX_SLIDER_STEPS + 1e-9) return { kind: 'slider', min, max, step };
    }
    const unit = typeof schema['unit'] === 'string' ? schema['unit'] : unitOf(unitKey);
    return {
      kind: 'number',
      integer,
      ...(min !== undefined && { min }),
      ...(max !== undefined && { max }),
      ...(unit !== undefined && { unit }),
    };
  }
  if (type === 'array') {
    return items['type'] === 'string' && items['enum'] === undefined
      ? { kind: 'tags' }
      : { kind: 'json' };
  }
  if (type === 'string') {
    if (!isColorPattern(schema['pattern'])) return { kind: 'text' };
    const fallback = schema['default'];
    return { kind: 'color', ...(typeof fallback === 'string' && { fallback }) };
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
      // `min`/`max` dentro de objeto herdam a unidade do pai (`thinkingDelayMs.min`).
      control: controlOf(
        schema,
        key,
        path,
        key === 'min' || key === 'max' ? (prefix.split('.').at(-1) ?? key) : key,
      ),
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

// Mesma regra do `toEnvSegment` do core: a API não informa o nome da variável (issue 317 do
// usebridger), então a tela a reconstrói.
const snake = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toUpperCase();

/** `BRIDGER_<PLUGIN>__<CAMPO>[__<SUB>]`: a variável que decide o campo (para a ajuda). */
export const envName = (plugin: string, path: string): string =>
  `BRIDGER_${snake(plugin)}__${path.split('.').map(snake).join('__')}`;

/** Quem decide o campo: `env` e `file` ganham do override, então a tela não deixa editar. */
export const isLocked = (source: string | undefined): boolean =>
  source === 'env' || source === 'file';

/**
 * Fonte do campo. Valor inteiro (record, array de objetos) tem a fonte nas chaves `${path}.*`:
 * qualquer env/arquivo trava o campo; senão, qualquer override preserva o valor inteiro.
 */
export function sourceOf(
  sources: Readonly<Record<string, string>>,
  path: string,
): string | undefined {
  const own = sources[path];
  if (own !== undefined) return own;
  const inner = Object.entries(sources)
    .filter(([key]) => key.startsWith(`${path}.`))
    .map(([, source]) => source);
  return inner.find(isLocked) ?? inner.find((source) => source === 'override');
}

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
    const source = sourceOf(sources, leaf.path);
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
