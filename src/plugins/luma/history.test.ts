import { describe, expect, it } from 'vitest';
import { createHistory, historyKey } from './history.ts';

const clock = (start = 1_000) => {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
};

describe('createHistory', () => {
  it('guarda fala e resposta como turnos alternados', () => {
    const h = createHistory({ maxMessages: 10, maxAgeMs: 1000 });
    h.add('c', 'Ana: oi', 'oi, tudo bem?');
    h.add('c', 'Ana: e aí', 'nada');

    expect(h.turns('c')).toEqual([
      { role: 'user', text: 'Ana: oi' },
      { role: 'assistant', text: 'oi, tudo bem?' },
      { role: 'user', text: 'Ana: e aí' },
      { role: 'assistant', text: 'nada' },
    ]);
    expect(h.turns('outro')).toEqual([]);
  });

  it('descarta os turnos mais antigos acima de maxMessages', () => {
    const h = createHistory({ maxMessages: 4, maxAgeMs: 1000 });
    for (const n of [1, 2, 3]) h.add('c', `u${n}`, `a${n}`);

    expect(h.turns('c').map((t) => t.text)).toEqual(['u2', 'a2', 'u3', 'a3']);
  });

  it('esquece a conversa parada por mais que maxAgeMs, sem timer', () => {
    const c = clock();
    const h = createHistory({ maxMessages: 10, maxAgeMs: 1000, now: c.now });
    h.add('c', 'u', 'a');

    c.advance(1000);
    expect(h.turns('c')).toHaveLength(2);
    c.advance(1);
    expect(h.turns('c')).toEqual([]);
    expect(h.size()).toBe(0);
  });

  it('uma nova fala renova a validade', () => {
    const c = clock();
    const h = createHistory({ maxMessages: 10, maxAgeMs: 1000, now: c.now });
    h.add('c', 'u1', 'a1');
    c.advance(800);
    h.add('c', 'u2', 'a2');
    c.advance(800);

    expect(h.turns('c')).toHaveLength(4);
  });

  it('a varredura do add tira as conversas expiradas sem ninguém ler', () => {
    const c = clock();
    const h = createHistory({ maxMessages: 10, maxAgeMs: 1000, now: c.now });
    h.add('a', 'u', 'a');
    h.add('b', 'u', 'a');
    c.advance(120_000);
    h.add('c', 'u', 'a');

    expect(h.size()).toBe(1);
  });

  it('clear devolve se havia conversa', () => {
    const h = createHistory({ maxMessages: 10, maxAgeMs: 1000 });
    h.add('c', 'u', 'a');

    expect(h.clear('c')).toBe(true);
    expect(h.clear('c')).toBe(false);
    expect(h.turns('c')).toEqual([]);
  });

  it('turns devolve cópia', () => {
    const h = createHistory({ maxMessages: 10, maxAgeMs: 1000 });
    h.add('c', 'u', 'a');
    h.turns('c').pop();

    expect(h.turns('c')).toHaveLength(2);
  });
});

describe('historyKey', () => {
  const sender = { id: 'ana@x' };
  it('em grupo, uma conversa por pessoa', () => {
    expect(historyKey({ chat: { id: 'g@x', isGroup: true }, sender } as never)).toBe('g@x:ana@x');
  });
  it('em privado, uma por chat', () => {
    expect(historyKey({ chat: { id: 'ana@x', isGroup: false }, sender } as never)).toBe('ana@x');
  });
});
