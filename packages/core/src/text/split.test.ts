// #273 (ADR 0061): divisão de texto longo sem quebrar a formatação.

import { describe, expect, it } from 'vitest';
import { bold, code, fmt, formatted, type MessageText, mention, plainText } from './format.ts';
import { splitText } from './split.ts';

const visible = (text: MessageText): number => plainText(text).length;
const limit = (n: number) => ({ first: n, rest: n });

describe('splitText', () => {
  it('texto que cabe volta sozinho, sem cópia', () => {
    const text = bold('curto');
    const parts = splitText(text, limit(10), visible);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(text);
  });

  it('prefere o parágrafo, depois a linha, depois o espaço', () => {
    expect(splitText('aaaa\n\nbbbb', limit(8), visible)).toEqual(['aaaa', 'bbbb']);
    expect(splitText('aaaa\nbbbb cc', limit(8), visible)).toEqual(['aaaa', 'bbbb cc']);
    expect(splitText('aaa bbb ccc', limit(8), visible)).toEqual(['aaa bbb', 'ccc']);
  });

  it('junta o que cabe em cada parte', () => {
    expect(splitText('a b c d e f', limit(5), visible)).toEqual(['a b c', 'd e f']);
  });

  it('sem separador, corta por caractere sem partir um par surrogate', () => {
    const parts = splitText('😀😀😀', limit(3), visible) as string[];
    expect(parts).toEqual(['😀', '😀', '😀']);
    expect(splitText('abcdefg', limit(3), visible)).toEqual(['abc', 'def', 'g']);
  });

  it('cada parte respeita o limite e, juntas, preservam o texto visível', () => {
    const words = Array.from({ length: 400 }, (_, i) => `palavra${i}`);
    const source = words.join(' ');
    const parts = splitText(source, limit(100), visible) as string[];
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(' ')).toBe(source);
  });

  it('um negrito partido continua negrito nas duas partes', () => {
    const parts = splitText(fmt`oi ${bold('aaaa bbbb')} fim`, limit(8), visible);
    expect(parts).toEqual([
      { type: 'formatted', nodes: ['oi ', { type: 'bold', children: ['aaaa'] }] },
      { type: 'formatted', nodes: [{ type: 'bold', children: ['bbbb'] }, ' fim'] },
    ]);
  });

  it('código longo vira dois códigos', () => {
    const parts = splitText(code('aaaa bbbb'), limit(5), visible);
    expect(parts).toEqual([
      { type: 'formatted', nodes: [{ type: 'code', text: 'aaaa ' }] },
      { type: 'formatted', nodes: [{ type: 'code', text: 'bbbb' }] },
    ]);
  });

  it('a menção nunca é cortada', () => {
    const maria = { id: 'u1', name: 'Maria', phone: null };
    const parts = splitText(fmt`oi ${mention(maria)} tudo bem`, limit(9), visible);
    expect(parts.map(plainText)).toEqual(['oi @Maria', 'tudo bem']);
  });

  it('a primeira parte segue o próprio limite (a legenda)', () => {
    expect(splitText('aa bb cc dd ee', { first: 2, rest: 8 }, visible)).toEqual([
      'aa',
      'bb cc dd',
      'ee',
    ]);
  });

  it('usa a medida do transport, que pode contar a marcação', () => {
    // Como o Discord: `**` conta.
    const markdown = (text: MessageText): number =>
      typeof text === 'string'
        ? text.length
        : text.nodes.reduce<number>(
            (n, node) =>
              n +
              (typeof node === 'string' ? node.length : plainText(formatted([node])).length + 4),
            0,
          );
    const parts = splitText(fmt`${bold('aaaa')} ${bold('bbbb')}`, limit(9), markdown);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => markdown(p) <= 9)).toBe(true);
  });

  it('texto cru continua cru em cada parte', () => {
    const parts = splitText('*a* *b*', limit(4), visible);
    expect(parts).toEqual(['*a*', '*b*']);
  });

  it('caractere maior que o limite sai sozinho, sem laço infinito', () => {
    expect(splitText('ab', limit(0), visible)).toEqual(['a', 'b']);
  });
});
