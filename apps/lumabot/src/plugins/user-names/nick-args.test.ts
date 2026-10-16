import { expect, it } from 'vitest';
import { nickFromArgs } from './nick-args.ts';

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
