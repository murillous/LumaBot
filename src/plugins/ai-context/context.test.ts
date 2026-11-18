import { describe, expect, it } from 'vitest';
import {
  CUT_MARK,
  compactInput,
  estimateTokens,
  KEEP_FULL,
  overflow,
  shorten,
  transcriptTokens,
  unsummarized,
} from './context.ts';
import type { Entry } from './transcript.ts';

const TZ = 'America/Sao_Paulo';

const entry = (n: number, text: string, over: Partial<Entry> = {}): Entry => ({
  ref: `m${n}`,
  at: Date.UTC(2026, 10, 17, 19, 0) + n * 60_000,
  fromLuma: false,
  name: 'Ana',
  text,
  ...over,
});

const many = (count: number, text = 'mensagem curta'): Entry[] =>
  Array.from({ length: count }, (_, i) => entry(i + 1, text));

describe('shorten (nível 1)', () => {
  it('fala antiga de alguém com texto longo vira trecho com a marca; o ID fica', () => {
    const long = 'a'.repeat(1000);
    const entries = [
      entry(1, long),
      ...many(KEEP_FULL).map((e, i) => ({ ...e, ref: `m${i + 2}` })),
    ];

    const [first] = shorten(entries);

    expect(first?.ref).toBe('m1');
    expect(first?.text?.endsWith(CUT_MARK)).toBe(true);
    expect(first?.text?.length).toBeLessThan(200);
  });

  it('as últimas falas e as da Luma ficam inteiras', () => {
    const long = 'b'.repeat(1000);
    const entries = [
      entry(1, long, { fromLuma: true, name: 'Luma' }),
      ...many(KEEP_FULL - 1).map((e, i) => ({ ...e, ref: `m${i + 2}` })),
      entry(KEEP_FULL + 1, long),
    ];

    expect(shorten(entries).map((e) => e.text)).toEqual(entries.map((e) => e.text));
  });
});

describe('orçamento', () => {
  it('estima para cima: três caracteres por token', () => {
    expect(estimateTokens('abcdefg')).toBe(3);
  });

  it('unsummarized deixa só as falas depois do resumo', () => {
    const entries = many(5);
    const summary = { text: 'r', through: 'm3', at: 0 };

    expect(unsummarized(entries, summary).map((e) => e.ref)).toEqual(['m4', 'm5']);
    expect(unsummarized(entries, undefined)).toHaveLength(5);
  });

  it('overflow conta quantas falas do começo saem para o resto caber', () => {
    const entries = many(40);
    const budget = transcriptTokens(entries.slice(25), TZ);

    const cut = overflow(entries, TZ, budget);

    expect(cut).toBe(25);
    expect(transcriptTokens(entries.slice(cut), TZ)).toBeLessThanOrEqual(budget);
    expect(overflow(entries, TZ, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('compactInput', () => {
  it('leva o resumo anterior e as falas com ID, hora e quem falou, a Luma pelo nome', () => {
    const text = compactInput(
      'Ana gosta de pizza (#m1).',
      [
        entry(4, 'bora pedir?', { media: 'figurinha' }),
        entry(5, 'bora!', { fromLuma: true, name: 'Luma' }),
      ],
      TZ,
    );

    expect(text).toContain('Resumo anterior:\nAna gosta de pizza (#m1).');
    expect(text).toMatch(/\[#m4 \d\d:\d\d\] Ana: \[figurinha\] bora pedir\?/);
    expect(text).toMatch(/\[#m5 \d\d:\d\d\] Luma: bora!/);
  });

  it('sem resumo anterior, diz que não há', () => {
    expect(compactInput(undefined, [entry(1, 'oi')], TZ)).toContain('Ainda não há resumo.');
  });
});
