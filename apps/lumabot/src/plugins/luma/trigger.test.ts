import { describe, expect, it } from 'vitest';
import { isTriggered, stripTrigger } from './trigger.ts';

const names = ['luma'];

describe('isTriggered', () => {
  it.each(['Luma, bom dia', 'luma', 'ei luma', 'oi LUMA!', 'será que a luma sabe?', 'fala, Luma?'])(
    'chama: %s',
    (text) => {
      expect(isTriggered(text, names)).toBe(true);
    },
  );

  it.each(['lumaluma', 'alumado', 'luminária', '', null, undefined])('não chama: %s', (text) => {
    expect(isTriggered(text, names)).toBe(false);
  });

  it('aceita mais de um nome e escapa o que for regex', () => {
    expect(isTriggered('oi lu', ['luma', 'lu'])).toBe(true);
    expect(isTriggered('abc', ['a.c'])).toBe(false);
    expect(isTriggered('a.c', ['a.c'])).toBe(true);
  });

  it('entende borda de palavra com acento', () => {
    expect(isTriggered('lumá', names)).toBe(false);
    expect(isTriggered('é a luma!', names)).toBe(true);
  });
});

describe('stripTrigger', () => {
  it.each([
    ['Luma, bom dia', 'bom dia'],
    ['ei luma qual é a boa?', 'qual é a boa?'],
    ['Oi Luma!  tudo bem', 'tudo bem'],
    ['e aí luma: me ajuda', 'me ajuda'],
    ['fala luma', ''],
  ])('%s → %s', (text, expected) => {
    expect(stripTrigger(text, names)).toBe(expected);
  });

  it('nome no meio da frase fica como veio', () => {
    expect(stripTrigger('será que a luma sabe?', names)).toBe('será que a luma sabe?');
  });

  it('não corta quem só começa com o nome', () => {
    expect(stripTrigger('lumaluma oi', names)).toBe('lumaluma oi');
  });
});
