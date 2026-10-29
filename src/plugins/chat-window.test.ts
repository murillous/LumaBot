import { describe, expect, it } from 'vitest';
import { createChatWindow } from './chat-window.ts';

const msg = (text: string) => ({ name: 'Ana', text });

describe('createChatWindow', () => {
  it('guarda as últimas mensagens de cada chat, da mais antiga para a mais nova', () => {
    const w = createChatWindow(3);
    for (const t of ['a', 'b', 'c', 'd']) w.push('g1', msg(t));
    w.push('g2', msg('x'));

    expect(w.recent('g1').map((m) => m.text)).toEqual(['b', 'c', 'd']);
    expect(w.recent('g2').map((m) => m.text)).toEqual(['x']);
    expect(w.recent('vazio')).toEqual([]);
  });

  it('recent(limit) devolve só as últimas e não expõe o array interno', () => {
    const w = createChatWindow(5);
    for (const t of ['a', 'b', 'c']) w.push('g', msg(t));

    expect(w.recent('g', 2).map((m) => m.text)).toEqual(['b', 'c']);
    w.recent('g').pop();
    expect(w.recent('g')).toHaveLength(3);
  });

  it('clear apaga só aquele chat', () => {
    const w = createChatWindow(5);
    w.push('g1', msg('a'));
    w.push('g2', msg('b'));
    w.clear('g1');

    expect(w.recent('g1')).toEqual([]);
    expect(w.recent('g2')).toHaveLength(1);
  });

  it('com chats demais, descarta o mais parado', () => {
    const w = createChatWindow(5, 2);
    w.push('g1', msg('a'));
    w.push('g2', msg('b'));
    w.push('g1', msg('c')); // g1 volta a ser o mais recente
    w.push('g3', msg('d'));

    expect(w.recent('g2')).toEqual([]);
    expect(w.recent('g1')).toHaveLength(2);
    expect(w.recent('g3')).toHaveLength(1);
  });
});
