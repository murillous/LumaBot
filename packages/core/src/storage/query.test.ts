import { describe, expect, it } from 'vitest';
import {
  cloneJson,
  normalizeDocument,
  normalizeIndexes,
  normalizeQuery,
  normalizeWhere,
} from './query.ts';

type Reminder = { chatId: string; fireAt: number; done: boolean };

describe('normalizeQuery', () => {
  it('sem consulta: sem condições, sem ordem, sem limite', () => {
    expect(normalizeQuery(undefined)).toEqual({
      where: [],
      orderBy: [],
      limit: undefined,
      offset: 0,
    });
  });

  it('achata filtros, ordenação e paginação na forma canônica', () => {
    const query = normalizeQuery<Reminder>({
      where: { chatId: 'x', fireAt: { gte: 1, lt: 9 }, done: { in: [false, null] } },
      orderBy: ['fireAt', { field: 'id', direction: 'desc' }],
      limit: 10,
      offset: 5,
    });
    expect(query).toEqual({
      where: [
        { field: 'chatId', op: 'eq', value: 'x' },
        { field: 'fireAt', op: 'gte', value: 1 },
        { field: 'fireAt', op: 'lt', value: 9 },
        { field: 'done', op: 'in', value: [false, null] },
      ],
      orderBy: [
        { field: 'fireAt', direction: 'asc' },
        { field: 'id', direction: 'desc' },
      ],
      limit: 10,
      offset: 5,
    });
  });

  it('orderBy único em objeto vira lista', () => {
    expect(normalizeQuery<Reminder>({ orderBy: { field: 'fireAt' } }).orderBy).toEqual([
      { field: 'fireAt', direction: 'asc' },
    ]);
  });

  it('recusa nome de campo que não é identificador simples', () => {
    for (const field of ['a.b', '', '1a', 'a-b', "a'b", '$.a']) {
      expect(() => normalizeWhere({ [field]: 1 })).toThrow(TypeError);
    }
  });

  it('copia o array de in (mutar a entrada depois não altera a condição)', () => {
    const values = [1, 2];
    const [condition] = normalizeWhere({ n: { in: values } });
    values.push(3);
    expect(condition).toEqual({ field: 'n', op: 'in', value: [1, 2] });
  });
});

describe('normalizeIndexes', () => {
  it('valida e remove repetidos', () => {
    expect(normalizeIndexes({ indexes: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
    expect(normalizeIndexes(undefined)).toEqual([]);
    expect(() => normalizeIndexes({ indexes: ['a.b'] })).toThrow(TypeError);
  });
});

describe('normalizeDocument e cloneJson', () => {
  it('devolve cópia JSON e recusa id', () => {
    const input = { a: [1], b: undefined };
    const copy = normalizeDocument(input);
    expect(copy).toEqual({ a: [1] });
    expect(copy['a']).not.toBe(input.a);
    expect(() => normalizeDocument({ id: '1' })).toThrow(TypeError);
    expect(() => normalizeDocument('x')).toThrow(TypeError);
  });

  it('cloneJson recusa o que o JSON não representa', () => {
    expect(cloneJson({ a: 1 })).toEqual({ a: 1 });
    expect(() => cloneJson(undefined as never)).toThrow(TypeError);
  });
});
