import { expect, it } from 'vitest';
import { cleanName, nickFromArgs } from './nick-args.ts';

it('sem menção devolve o texto limpo', () => {
  expect(nickFromArgs('  Ana   Maria ', [])).toBe('Ana Maria');
});

it('tira o trecho literal da menção, em qualquer posição', () => {
  expect(nickFromArgs('@5511 Zé', ['@5511'])).toBe('Zé');
  expect(nickFromArgs('Zé @5511', ['@5511'])).toBe('Zé');
});

it('sem tag, tira @dígitos', () => {
  expect(nickFromArgs('@123 Zé', [undefined])).toBe('Zé');
});

it('só a menção deixa o apelido vazio', () => {
  expect(nickFromArgs('@5511', ['@5511'])).toBe('');
});

it('menção só sai como token inteiro', () => {
  expect(nickFromArgs('@55119999 Zé', ['@5511'])).toBe('@55119999 Zé');
  expect(nickFromArgs('a@5511 Zé', ['@5511'])).toBe('a@5511 Zé');
});

it('cleanName normaliza, tira controle/bidi/largura zero e colapsa espaços', () => {
  expect(cleanName('e\u0301')).toBe('\u00e9');
  expect(cleanName(' a\u202Eb\u200Bc\n\td ')).toBe('a b c d');
  expect(cleanName('\u200B\u202E')).toBe('');
});
