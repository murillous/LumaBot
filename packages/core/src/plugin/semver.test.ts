import { describe, expect, it } from 'vitest';
import { compareVersions, isValidRange, parseVersion, type SemVer, satisfies } from './semver.ts';

const v = (text: string): SemVer => {
  const parsed = parseVersion(text);
  if (!parsed) throw new Error(`versão inválida no teste: ${text}`);
  return parsed;
};

describe('parseVersion', () => {
  it('aceita M.m.p com pré-release e build', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('1.0.0-beta.2+sha.1')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['beta', 2],
    });
  });

  it.each(['1.2', '1', 'v1.2.3', '01.2.3', '1.2.3-', 'x.1.2', '', '1.2.3.4'])(
    'recusa %s',
    (text) => {
      expect(parseVersion(text)).toBeUndefined();
    },
  );
});

describe('compareVersions', () => {
  it('ordena como o semver 2.0.0 (§11)', () => {
    const sorted = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ];
    const shuffled = [...sorted].reverse();
    expect(shuffled.sort((a, b) => compareVersions(v(a), v(b)))).toEqual(sorted);
  });

  it('ignora build', () => {
    expect(compareVersions(v('1.0.0+a'), v('1.0.0+b'))).toBe(0);
  });
});

describe('satisfies', () => {
  it.each([
    // caret
    ['1.2.3', '^1.2.3', true],
    ['1.9.0', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['1.2.2', '^1.2.3', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['0.0.9', '^0.0', true],
    ['0.1.0', '^0.0', false],
    ['0.9.0', '^0.x', true],
    ['1.0.0', '^0.x', false],
    ['1.5.0', '^1.2', true],
    ['1.1.0', '^1.2', false],
    // til
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.9.0', '~1', true],
    ['2.0.0', '~1', false],
    // comparadores
    ['1.0.0', '>=1.0.0', true],
    ['0.9.9', '>=1.0.0', false],
    ['1.0.1', '>1.0.0', true],
    ['1.0.0', '>1.0.0', false],
    ['1.3.0', '>1.2', true],
    ['1.2.9', '>1.2', false],
    ['1.9.9', '<2', true],
    ['2.0.0', '<2', false],
    ['1.2.9', '<=1.2', true],
    ['1.3.0', '<=1.2', false],
    ['1.0.0', '<=1.0.0', true],
    ['1.0.0', '=1.0.0', true],
    ['1.0.1', '1.0.0', false],
    // curingas e parciais
    ['3.4.5', '*', true],
    ['3.4.5', '', true],
    ['1.7.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.2.7', '1.2.X', true],
    ['1.3.0', '1.2', false],
    ['0.0.0', '>=0.0.0', true],
    ['1.0.0', '<*', false],
    // E e OU
    ['1.5.0', '>=1.2.0 <2.0.0', true],
    ['2.0.0', '>=1.2.0 <2.0.0', false],
    ['1.5.0', '>= 1.2.0  < 2.0.0', true],
    ['3.1.0', '^1.0.0 || ^3.0.0', true],
    ['2.1.0', '^1.0.0 || ^3.0.0', false],
    // pré-release só casa com comparador da mesma M.m.p que cite pré-release
    ['1.1.0-beta', '^1.0.0', false],
    ['1.1.0-beta', '^1.1.0-alpha', true],
    ['1.1.0-alpha', '^1.1.0-beta', false],
    ['1.2.0-rc.1', '>=1.0.0', false],
    ['1.0.0-rc.1', '*', false],
  ] as const)('%s em "%s" → %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it('lança RangeError para versão ou faixa inválida', () => {
    expect(() => satisfies('1.0', '^1.0.0')).toThrow(RangeError);
    expect(() => satisfies('1.0.0', '1.0.0 - 2.0.0')).toThrow(RangeError);
  });
});

describe('isValidRange', () => {
  it.each(['^1.0.0', '~1.2', '>=1 <2', '1.x || 2.x', '*', 'x', '1.2.3-beta.1'])(
    '%s é válida',
    (r) => {
      expect(isValidRange(r)).toBe(true);
    },
  );

  it.each(['1.0.0 - 2.0.0', 'latest', '^^1', '1.x.3', '>=01.0.0', '~>1.0'])(
    '%s é inválida',
    (r) => {
      expect(isValidRange(r)).toBe(false);
    },
  );
});
