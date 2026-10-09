import { describe, expect, it } from 'vitest';
import { collectGarbage, median, percentile } from './stats.ts';

describe('percentile', () => {
  it('pega o vizinho mais próximo sem ordenar a lista original', () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 99)).toBe(5);
    expect(percentile(values, 0)).toBe(1);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });

  it('p99 de 100 valores é o 99º', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 99)).toBe(99);
  });

  it('recusa lista vazia e percentil fora de 0–100', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });
});

describe('median', () => {
  it('é o percentil 50', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
});

describe('collectGarbage', () => {
  it('roda sem --expose-gc', () => {
    expect(() => collectGarbage()).not.toThrow();
  });
});
