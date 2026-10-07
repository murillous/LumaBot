// Subconjunto de semver suficiente para `engine` e `dependsOn` (ADR 0016): versões
// `M.m.p[-pre][+build]` e faixas com `^`, `~`, `>=`, `>`, `<=`, `<`, `=`, curingas (`x`, `X`,
// `*`, versão parcial), comparadores separados por espaço (E) e `||` (OU). Faixas com hífen
// (`1.0.0 - 2.0.0`) ficam de fora. Implementado aqui em vez do pacote `semver` para o core não
// carregar dependência de runtime por ~100 linhas; a semântica segue a do npm, inclusive a
// regra de pré-release (ver `satisfies`).

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

type Operator = '<' | '<=' | '>' | '>=' | '=';

interface Comparator {
  readonly operator: Operator;
  readonly version: SemVer;
}

const NUMBER = '0|[1-9]\\d*';
const IDENTIFIER = '[0-9A-Za-z-]+';
const PRERELEASE = `${IDENTIFIER}(?:\\.${IDENTIFIER})*`;
const VERSION = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${PRERELEASE}))?(?:\\+${PRERELEASE})?$`,
);
const PART = `${NUMBER}|x|X|\\*`;
const PARTIAL = new RegExp(
  `^(\\^|~|>=|<=|>|<|=)?(${PART})(?:\\.(${PART})(?:\\.(${PART})(?:-(${PRERELEASE}))?(?:\\+${PRERELEASE})?)?)?$`,
);

function parsePrerelease(raw: string | undefined): (string | number)[] {
  if (raw === undefined) return [];
  return raw.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id));
}

/** Versão exata (`1.2.3`, `1.0.0-beta.1`); `undefined` se não for semver válido. */
export function parseVersion(value: string): SemVer | undefined {
  const match = VERSION.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: parsePrerelease(match[4]),
  };
}

function compareIdentifiers(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // Identificador numérico tem precedência menor que alfanumérico.
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negativo, zero ou positivo, como em `Array#sort`. `+build` não conta. */
export function compareVersions(a: SemVer, b: SemVer): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) return core;
  // Sem pré-release é maior que com: 1.0.0 > 1.0.0-rc.1.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const diff = compareIdentifiers(x, y);
    if (diff !== 0) return diff;
  }
  return 0;
}

const version = (
  major: number,
  minor: number,
  patch: number,
  prerelease: (string | number)[] = [],
): SemVer => ({ major, minor, patch, prerelease });

const comparator = (operator: Operator, v: SemVer): Comparator => ({ operator, version: v });

// Nada é menor que 0.0.0-0: um comparador que nenhuma versão satisfaz (ex.: `<*`).
const NOTHING: Comparator[] = [comparator('<', version(0, 0, 0, [0]))];

function parsePart(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === 'x' || raw === 'X' || raw === '*') return undefined;
  return Number(raw);
}

/** Converte um termo da faixa (`^1.2`, `>=1.0.0`, `1.x`) em comparadores; `undefined` se inválido. */
function desugar(term: string): Comparator[] | undefined {
  const match = PARTIAL.exec(term);
  if (!match) return undefined;
  const operator = match[1] ?? '=';
  const major = parsePart(match[2]);
  const minor = parsePart(match[3]);
  const patch = parsePart(match[4]);
  // Curinga só no fim: `1.x.3` não é faixa.
  if (
    (major === undefined && match[3] !== undefined) ||
    (minor === undefined && match[4] !== undefined)
  ) {
    return undefined;
  }
  const pre = parsePrerelease(match[5]);
  if (major === undefined) return operator === '<' || operator === '>' ? NOTHING : [];
  const low = version(major, minor ?? 0, patch ?? 0, pre);

  switch (operator) {
    case '=':
      if (minor === undefined)
        return [comparator('>=', low), comparator('<', version(major + 1, 0, 0))];
      if (patch === undefined) {
        return [comparator('>=', low), comparator('<', version(major, minor + 1, 0))];
      }
      return [comparator('=', low)];
    case '^': {
      let high: SemVer;
      if (major > 0 || minor === undefined) high = version(major + 1, 0, 0);
      else if (minor > 0 || patch === undefined) high = version(0, minor + 1, 0);
      else high = version(0, 0, patch + 1);
      return [comparator('>=', low), comparator('<', high)];
    }
    case '~': {
      const high = minor === undefined ? version(major + 1, 0, 0) : version(major, minor + 1, 0);
      return [comparator('>=', low), comparator('<', high)];
    }
    case '>':
      if (minor === undefined) return [comparator('>=', version(major + 1, 0, 0))];
      if (patch === undefined) return [comparator('>=', version(major, minor + 1, 0))];
      return [comparator('>', low)];
    case '<=':
      if (minor === undefined) return [comparator('<', version(major + 1, 0, 0))];
      if (patch === undefined) return [comparator('<', version(major, minor + 1, 0))];
      return [comparator('<=', low)];
    default:
      // `>=` e `<` com versão parcial completam com zeros.
      return [comparator(operator as Operator, low)];
  }
}

/** Conjuntos de comparadores (OU entre conjuntos, E dentro de cada um); `undefined` se inválida. */
function parseRange(range: string): Comparator[][] | undefined {
  const sets: Comparator[][] = [];
  for (const raw of range.split('||')) {
    // `>= 1.2.3` vale como `>=1.2.3`.
    const terms = raw
      .trim()
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
      .split(/\s+/)
      .filter((term) => term.length > 0);
    const set: Comparator[] = [];
    for (const term of terms) {
      const comparators = desugar(term);
      if (!comparators) return undefined;
      set.push(...comparators);
    }
    sets.push(set);
  }
  return sets;
}

/** `true` se `range` é uma faixa que este subconjunto entende. */
export function isValidRange(range: string): boolean {
  return parseRange(range) !== undefined;
}

function test(v: SemVer, { operator, version: other }: Comparator): boolean {
  const diff = compareVersions(v, other);
  switch (operator) {
    case '<':
      return diff < 0;
    case '<=':
      return diff <= 0;
    case '>':
      return diff > 0;
    case '>=':
      return diff >= 0;
    default:
      return diff === 0;
  }
}

/**
 * `version` está dentro de `range`? Lança `RangeError` se algum dos dois for inválido.
 *
 * Como no npm, uma versão de pré-release só satisfaz a faixa se algum comparador do mesmo
 * conjunto citar pré-release da mesma `M.m.p`: `^1.0.0` não aceita `1.1.0-beta`, mas
 * `^1.1.0-alpha` aceita. Isso evita que um plugin estável carregue em core instável por acaso.
 */
export function satisfies(versionText: string, range: string): boolean {
  const v = parseVersion(versionText);
  if (!v) throw new RangeError(`Versão semver inválida: "${versionText}"`);
  const sets = parseRange(range);
  if (!sets) throw new RangeError(`Faixa semver inválida: "${range}"`);
  return sets.some((set) => {
    if (!set.every((c) => test(v, c))) return false;
    if (v.prerelease.length === 0) return true;
    return set.some(
      ({ version: c }) =>
        c.prerelease.length > 0 &&
        c.major === v.major &&
        c.minor === v.minor &&
        c.patch === v.patch,
    );
  });
}
