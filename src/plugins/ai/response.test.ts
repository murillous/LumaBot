import { describe, expect, it } from 'vitest';
import { cleanResponse, splitIntoParts } from './response.ts';

describe('cleanResponse', () => {
  it('tira o raciocínio, o rótulo e os espaços', () => {
    expect(cleanResponse('  <think>hmm\ncalcula</think>Luma: oi, tudo bem?  ')).toBe(
      'oi, tudo bem?',
    );
  });

  it('limita a repetição desenfreada de um caractere a 30', () => {
    expect(cleanResponse(`a${'k'.repeat(200)}b`)).toBe(`a${'k'.repeat(30)}b`);
  });

  it('deixa passar a repetição curta', () => {
    expect(cleanResponse('kkkkkkk')).toBe('kkkkkkk');
  });

  it('texto vazio continua vazio', () => {
    expect(cleanResponse('<think>só pensando</think>')).toBe('');
  });
});

describe('splitIntoParts', () => {
  const opts = { maxLength: 30, maxParts: 2 };

  it('divide pelo marcador [PARTE] e descarta o excedente', () => {
    expect(splitIntoParts('um[PARTE]dois[PARTE]três', opts)).toEqual(['um', 'dois']);
  });

  it('com um marcador só e texto curto, devolve o texto como veio', () => {
    expect(splitIntoParts('só um[PARTE]', { ...opts, maxLength: 100 })).toEqual(['só um[PARTE]']);
  });

  it('texto curto sem marcador fica inteiro', () => {
    expect(splitIntoParts('oi tudo bem', opts)).toEqual(['oi tudo bem']);
  });

  it('corta o texto longo numa pontuação perto do limite', () => {
    const text = 'Eu fui ao mercado ontem. Comprei pão e leite e voltei.';
    expect(splitIntoParts(text, opts)).toEqual([
      'Eu fui ao mercado ontem.',
      'Comprei pão e leite e voltei.',
    ]);
  });

  it('sem ponto natural, corta no limite', () => {
    expect(splitIntoParts('a'.repeat(50), opts)).toEqual(['a'.repeat(30), 'a'.repeat(20)]);
  });

  it('respeita maxParts mesmo com texto sobrando', () => {
    expect(splitIntoParts('a'.repeat(200), opts)).toHaveLength(2);
  });

  it('vazio não gera balão', () => {
    expect(splitIntoParts('', opts)).toEqual([]);
  });
});
