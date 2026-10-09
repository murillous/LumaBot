// #273 (ADR 0061): helpers do texto formatado neutro.

import { describe, expect, it } from 'vitest';
import { bold, code, fmt, isFormatted, italic, link, mention, plainText } from './format.ts';

const maria = { id: 'u1', name: 'Maria', phone: '5511999999999' };

describe('helpers de formatação', () => {
  it('fmt compõe texto literal e trechos formatados numa árvore plana', () => {
    const text = fmt`Notas de ${bold('Maria')}: ${8.5} ${italic('ok')}`;
    expect(text).toEqual({
      type: 'formatted',
      nodes: [
        'Notas de ',
        { type: 'bold', children: ['Maria'] },
        ': ',
        '8.5',
        ' ',
        { type: 'italic', children: ['ok'] },
      ],
    });
  });

  it('a árvore é congelada', () => {
    const text = bold('a', italic('b'));
    expect(Object.isFrozen(text)).toBe(true);
    expect(Object.isFrozen(text.nodes)).toBe(true);
    expect(Object.isFrozen(text.nodes[0])).toBe(true);
  });

  it('texto interpolado é literal: marcação do usuário não vira estilo', () => {
    const text = fmt`oi ${'*não negrito*'}`;
    expect(text.nodes).toEqual(['oi ', '*não negrito*']);
  });

  it('estilo, código e trecho vazios somem', () => {
    expect(bold().nodes).toEqual([]);
    expect(italic('').nodes).toEqual([]);
    expect(code('').nodes).toEqual([]);
    expect(fmt`${bold()}x`.nodes).toEqual(['x']);
  });

  it('estilos aninham', () => {
    expect(bold('a', italic('b')).nodes).toEqual([
      { type: 'bold', children: ['a', { type: 'italic', children: ['b'] }] },
    ]);
  });

  it('link sem rótulo mostra a URL; só http e https', () => {
    expect(link('https://ex.com/a').nodes).toEqual([
      { type: 'link', url: 'https://ex.com/a', children: ['https://ex.com/a'] },
    ]);
    expect(link('https://ex.com', bold('site')).nodes).toEqual([
      { type: 'link', url: 'https://ex.com', children: [{ type: 'bold', children: ['site'] }] },
    ]);
    expect(() => link('javascript:alert(1)')).toThrow(TypeError);
    expect(() => link('não é url')).toThrow(TypeError);
  });

  it('mention guarda só o que o transport precisa, sem os claims', () => {
    const text = mention({ ...maria, username: 'maria', claims: { role: 'x' } } as never);
    expect(text.nodes).toEqual([
      {
        type: 'mention',
        contact: { id: 'u1', name: 'Maria', phone: '5511999999999', username: 'maria' },
      },
    ]);
    expect(() => mention({ id: '', name: null, phone: null })).toThrow(TypeError);
  });

  it('rejeita o que não é texto, vindo de JS sem tipos', () => {
    expect(() => bold(42 as never)).toThrow(TypeError);
    expect(() => fmt`${null as never}`).toThrow(TypeError);
    expect(() => code(1 as never)).toThrow(TypeError);
  });

  it('isFormatted distingue a árvore', () => {
    expect(isFormatted(bold('x'))).toBe(true);
    expect(isFormatted('x')).toBe(false);
    expect(isFormatted({ type: 'text', text: 'x' })).toBe(false);
  });
});

describe('plainText', () => {
  it('devolve o texto visível, sem marcação', () => {
    const text = fmt`${bold('a', italic('b'))} ${code('c()')} ${link('https://x.io', 'site')}`;
    expect(plainText(text)).toBe('ab c() site');
  });

  it('menção vira @ com usuário, nome, telefone ou ID, nessa ordem', () => {
    expect(plainText(mention({ ...maria, username: 'mari' }))).toBe('@mari');
    expect(plainText(mention(maria))).toBe('@Maria');
    expect(plainText(mention({ ...maria, name: null }))).toBe('@5511999999999');
    expect(plainText(mention({ id: 'u9', name: null, phone: null }))).toBe('@u9');
  });

  it('string crua volta como está', () => {
    expect(plainText('*cru*')).toBe('*cru*');
  });
});
