import { describe, expect, it } from 'vitest';
import {
  createTranscript,
  type Entry,
  mediaKind,
  type NewEntry,
  replyNote,
  stripHeader,
  toTurns,
} from './transcript.ts';

const clock = (start = 1_000) => {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
};

const said = (name: string, text: string, over: Partial<NewEntry> = {}): NewEntry => ({
  at: 0,
  fromSelf: false,
  name,
  text,
  ...over,
});

describe('createTranscript', () => {
  it('dá um ID curto em sequência para cada fala do chat', () => {
    const t = createTranscript({ maxMessages: 10, maxAgeMs: 1000, now: () => 0 });

    expect(t.add('c', said('Ana', 'oi'), ['w1']).ref).toBe('m1');
    expect(t.add('c', said('Bia', 'olá'), ['w2']).ref).toBe('m2');
    expect(t.add('outro', said('Caio', 'e aí'), ['w3']).ref).toBe('m1');
    expect(t.entries('c').map((e) => e.text)).toEqual(['oi', 'olá']);
  });

  it('acha a fala por qualquer um dos IDs da plataforma, só no próprio chat', () => {
    const t = createTranscript({ maxMessages: 10, maxAgeMs: 1000, now: () => 0 });
    t.add('c', said('Luma', 'a b', { fromSelf: true }), ['p1', 'p2']);

    expect(t.find('c', 'p1')?.ref).toBe('m1');
    expect(t.find('c', 'p2')?.ref).toBe('m1');
    expect(t.find('c', 'x')).toBeUndefined();
    expect(t.find('outro', 'p1')).toBeUndefined();
  });

  it('acha a fala pelo ID curto, com ou sem #, só no próprio chat', () => {
    const t = createTranscript({ maxMessages: 10, maxAgeMs: 1000, now: () => 0 });
    t.add('c', said('Ana', 'oi'), ['w1']);

    expect(t.get('c', 'm1')?.text).toBe('oi');
    expect(t.get('c', ' #M1 ')?.text).toBe('oi');
    expect(t.get('c', 'm2')).toBeUndefined();
    expect(t.get('outro', 'm1')).toBeUndefined();
  });

  it('cada fala expira sozinha depois de maxAgeMs, sem timer', () => {
    const c = clock();
    const t = createTranscript({ maxMessages: 10, maxAgeMs: 1000, now: c.now });
    t.add('c', said('Ana', 'velha', { at: c.now() }), ['w1']);
    c.advance(600);
    t.add('c', said('Bia', 'nova', { at: c.now() }), ['w2']);
    c.advance(600);

    expect(t.entries('c').map((e) => e.text)).toEqual(['nova']);
    expect(t.find('c', 'w1')).toBeUndefined();
  });

  it('o ID não volta atrás enquanto o chat vive, mesmo com falas expirando', () => {
    const c = clock();
    const t = createTranscript({ maxMessages: 10, maxAgeMs: 1000, now: c.now });
    t.add('c', said('Ana', 'a', { at: c.now() }), ['w1']);
    c.advance(600);
    t.add('c', said('Ana', 'b', { at: c.now() }), ['w2']);
    c.advance(600);

    expect(t.add('c', said('Ana', 'c', { at: c.now() }), ['w3']).ref).toBe('m3');
  });

  it('acima de maxMessages, a mais antiga sai e o ID dela some', () => {
    const t = createTranscript({ maxMessages: 2, maxAgeMs: 1000, now: () => 0 });
    t.add('c', said('Ana', 'a'), ['w1']);
    t.add('c', said('Ana', 'b'), ['w2']);
    t.add('c', said('Ana', 'c'), ['w3']);

    expect(t.entries('c').map((e) => e.text)).toEqual(['b', 'c']);
    expect(t.find('c', 'w1')).toBeUndefined();
  });

  it('no máximo maxChats chats: o mais parado sai primeiro', () => {
    const t = createTranscript({ maxMessages: 5, maxAgeMs: 1000, maxChats: 2, now: () => 0 });
    t.add('a', said('Ana', '1'), ['w1']);
    t.add('b', said('Ana', '2'), ['w2']);
    t.add('a', said('Ana', '3'), ['w3']);
    t.add('c', said('Ana', '4'), ['w4']);

    expect(t.entries('b')).toEqual([]);
    expect(t.size()).toBe(2);
  });

  it('clear esquece o chat, e size conta só os vivos', () => {
    const c = clock();
    const t = createTranscript({ maxMessages: 5, maxAgeMs: 1000, now: c.now });
    t.add('a', said('Ana', '1', { at: c.now() }), ['w1']);
    t.add('b', said('Ana', '2', { at: c.now() }), ['w2']);

    expect(t.clear('a')).toBe(true);
    expect(t.clear('a')).toBe(false);
    expect(t.size()).toBe(1);
    c.advance(2000);
    expect(t.size()).toBe(0);
  });

  it('guarda o resumo do chat enquanto a fala mais nova que ele cobre viveria', () => {
    const c = clock();
    const t = createTranscript({ maxMessages: 10, maxAgeMs: 1000, now: c.now });
    t.add('c', said('Ana', 'oi', { at: 1_000 }), ['w1']);
    t.add('c', said('Bia', 'olá', { at: 1_500 }), ['w2']);

    t.setSummary('c', { text: 'Ana e Bia se cumprimentaram', through: 'm1', at: 1_000 });
    expect(t.summary('c')?.text).toBe('Ana e Bia se cumprimentaram');

    // m1 (o fim do resumo) expira, m2 fica.
    c.advance(1200);
    expect(t.summary('c')).toBeUndefined();
    expect(t.entries('c').map((e) => e.ref)).toEqual(['m2']);
  });

  it('ignora o resumo de falas que não estão mais lá, e o clear o esquece', () => {
    const t = createTranscript({ maxMessages: 10, maxAgeMs: 1000, now: () => 0 });
    t.add('c', said('Ana', 'oi'), ['w1']);

    t.setSummary('c', { text: 'velho', through: 'm7', at: 0 });
    expect(t.summary('c')).toBeUndefined();

    t.setSummary('c', { text: 'ok', through: 'm1', at: 0 });
    t.clear('c');
    t.add('c', said('Ana', 'de novo'), ['w2']);
    expect(t.summary('c')).toBeUndefined();
  });

  it('entries devolve cópia', () => {
    const t = createTranscript({ maxMessages: 5, maxAgeMs: 1000, now: () => 0 });
    t.add('c', said('Ana', 'a'), ['w1']);
    t.entries('c').pop();

    expect(t.entries('c')).toHaveLength(1);
  });
});

describe('toTurns', () => {
  // 19:30 UTC é 16:30 em Brasília.
  const at = Date.parse('2026-10-18T19:30:00Z');
  const entry = (ref: string, over: Partial<Entry>): Entry => ({
    ref,
    at,
    fromSelf: false,
    name: 'Ana',
    text: null,
    ...over,
  });

  it('junta as falas seguidas das pessoas num turno, com cabeçalho; as dela vão sem', () => {
    const turns = toTurns(
      [
        entry('m1', { name: 'Ana', text: 'oi' }),
        entry('m2', { name: 'Bia', text: 'olá' }),
        entry('m3', { fromSelf: true, name: 'Luma', text: 'fala, gente' }),
        entry('m4', { name: 'Caio', text: 'e aí' }),
      ],
      'America/Sao_Paulo',
    );

    expect(turns).toEqual([
      { role: 'user', text: '[#m1 16:30] Ana: oi\n[#m2 16:30] Bia: olá' },
      { role: 'assistant', text: 'fala, gente' },
      { role: 'user', text: '[#m4 16:30] Caio: e aí' },
    ]);
  });

  it('marca a mídia e a citação, que aponta para o ID', () => {
    const [turn] = toTurns(
      [
        entry('m1', { media: 'sticker' }),
        entry('m2', { name: 'Bia', text: 'kkkk', replyTo: 'm1' }),
        entry('m3', { name: 'Bia', media: 'image', text: 'olha', replyTo: 'sumiu' }),
      ],
      'America/Sao_Paulo',
    );

    expect(turn?.text).toBe(
      '[#m1 16:30] Ana: [figurinha]\n[#m2 16:30] Bia: (respondendo #m1) kkkk\n[#m3 16:30] Bia: [imagem] olha',
    );
  });
});

describe('replyNote', () => {
  const base: Entry = { ref: 'm4', at: 0, fromSelf: false, name: 'Ana', text: 'oi' };

  it('de alguém, o ID; dela, um trecho do que ela disse', () => {
    expect(replyNote(undefined)).toBe('');
    expect(replyNote(base)).toBe('(respondendo #m4)');
    expect(replyNote({ ...base, fromSelf: true, text: 'pizza  de\ncalabresa' })).toBe(
      '(respondendo à sua fala "pizza de calabresa")',
    );
    expect(replyNote({ ...base, fromSelf: true, text: 'x'.repeat(100) })).toBe(
      `(respondendo à sua fala "${'x'.repeat(80)}…")`,
    );
  });
});

describe('mediaKind e stripHeader', () => {
  it('lê o tipo da mensagem como mídia; texto não é mídia', () => {
    expect(mediaKind('sticker')).toBe('sticker');
    expect(mediaKind('voice')).toBe('audio');
    expect(mediaKind('text')).toBeUndefined();
  });

  it('tira o cabeçalho que o modelo imitou no começo da resposta', () => {
    expect(stripHeader('[#m12 16:30] ➜ oi gente')).toBe('oi gente');
    expect(stripHeader('[#m3 09:01] oi')).toBe('oi');
    expect(stripHeader('oi [#m3] no meio fica')).toBe('oi [#m3] no meio fica');
  });
});
