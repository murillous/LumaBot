import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coerceEnvValue, envCollisions, envName, readEnvFields, toEnvSegment } from './env.ts';

describe('envName', () => {
  it('converte plugin kebab-case e campos camelCase para SCREAMING_SNAKE com __ entre níveis', () => {
    expect(toEnvSegment('apiKey')).toBe('API_KEY');
    expect(toEnvSegment('openAIKey')).toBe('OPEN_AI_KEY');
    expect(toEnvSegment('user-names')).toBe('USER_NAMES');
    expect(envName('sticker', ['quality'])).toBe('ZAPFORGE_STICKER__QUALITY');
    expect(envName('user-names', ['openai', 'apiKey'])).toBe(
      'ZAPFORGE_USER_NAMES__OPENAI__API_KEY',
    );
  });
});

describe('coerceEnvValue', () => {
  it('converte texto para o tipo do schema, atravessando optional/default', () => {
    expect(coerceEnvValue('42', z.number().default(1))).toBe(42);
    expect(coerceEnvValue('true', z.boolean().optional())).toBe(true);
    expect(coerceEnvValue('0', z.boolean())).toBe(false);
    expect(coerceEnvValue('abc', z.string())).toBe('abc');
    expect(coerceEnvValue('a', z.enum(['a', 'b']))).toBe('a');
    expect(coerceEnvValue('2', z.literal(2))).toBe(2);
    expect(coerceEnvValue('["x","y"]', z.array(z.string()))).toEqual(['x', 'y']);
  });

  it('devolve o texto cru quando não converte, para o Zod rejeitar', () => {
    expect(coerceEnvValue('muito', z.number())).toBe('muito');
    expect(coerceEnvValue('', z.number())).toBe('');
    expect(coerceEnvValue('talvez', z.boolean())).toBe('talvez');
    expect(coerceEnvValue('não é json', z.array(z.string()))).toBe('não é json');
  });
});

describe('readEnvFields', () => {
  it('só procura campos declarados, inclusive aninhados', () => {
    const shape = z.object({
      quality: z.number(),
      openai: z.object({ apiKey: z.string() }).optional(),
    }).shape;
    const found = readEnvFields('ai', shape, {
      ZAPFORGE_AI__QUALITY: '9',
      ZAPFORGE_AI__OPENAI__API_KEY: 'k',
      ZAPFORGE_AI__INEXISTENTE: 'x',
    });
    expect(found).toEqual([
      { path: ['quality'], name: 'ZAPFORGE_AI__QUALITY', value: 9 },
      { path: ['openai', 'apiKey'], name: 'ZAPFORGE_AI__OPENAI__API_KEY', value: 'k' },
    ]);
  });
});

describe('envCollisions', () => {
  it('só devolve variáveis com mais de um caminho, inclusive aninhados', () => {
    const shape = {
      a: z.object({ bC: z.string(), b_c: z.string() }),
      ok: z.string(),
    };
    expect(envCollisions('p', shape, ['ok'])).toEqual(
      new Map([['ZAPFORGE_P__A__B_C', ['a.bC', 'a.b_c']]]),
    );
  });
});
