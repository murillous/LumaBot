import { describe, expect, it } from 'vitest';
import { PERSONAS } from './personas.ts';
import { buildPrompt, type QuotedInfo, quotedContext } from './prompt.ts';

const persona = PERSONAS[0];
if (!persona) throw new Error('sem persona de fábrica');

const base = {
  persona,
  now: new Date('2026-10-18T19:30:00Z'),
  timeZone: 'America/Sao_Paulo',
  senderName: 'Ana',
  userText: 'oi',
  history: [],
};

describe('buildPrompt', () => {
  it('põe a persona e o formato no sistema; o dia de hoje vai na fala de agora', () => {
    const { instructions, messages } = buildPrompt({
      ...base,
      header: '[#m3 16:30]',
      today: 'domingo, 18/10/2026',
    });

    expect(instructions).toContain(persona.context);
    expect(instructions).toContain(persona.style);
    for (const trait of persona.traits) expect(instructions).toContain(`- ${trait}`);
    expect(instructions).toContain('[PARTE]');
    expect(instructions).toContain('America/Sao_Paulo');
    expect(instructions).not.toMatch(/2026|domingo/);
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: '[hoje é domingo, 18/10/2026]\n[#m3 16:30] ➜ Ana: oi',
    });
  });

  it('a fala de agora é o último turno do usuário, com o rótulo de quem falou', () => {
    const { messages } = buildPrompt({
      ...base,
      history: [
        { role: 'user', text: 'Ana: antes' },
        { role: 'assistant', text: 'resposta' },
      ],
    });

    expect(messages).toEqual([
      { role: 'user', content: 'Ana: antes' },
      { role: 'assistant', content: 'resposta' },
      { role: 'user', content: 'Ana: oi' },
    ]);
  });

  it('descarta fala da Luma órfã no começo do histórico', () => {
    const { messages } = buildPrompt({
      ...base,
      history: [
        { role: 'assistant', text: 'órfã' },
        { role: 'user', text: 'Ana: a' },
        { role: 'assistant', text: 'b' },
      ],
    });

    expect(messages[0]).toEqual({ role: 'user', content: 'Ana: a' });
    expect(messages).toHaveLength(3);
  });

  it('com cabeçalho, a fala de agora ganha o ID, a hora e a marca de que é com ela', () => {
    const { messages } = buildPrompt({ ...base, header: '[#m3 16:30]' });

    expect(messages.at(-1)).toEqual({ role: 'user', content: '[#m3 16:30] ➜ Ana: oi' });
  });

  it('o que o grupo disse desde a última fala dela e a fala de agora são um turno só', () => {
    const { messages } = buildPrompt({
      ...base,
      header: '[#m3 16:30]',
      history: [
        { role: 'user', text: '[#m1 16:29] Bia: alguém viu o jogo?' },
        { role: 'assistant', text: 'vi sim' },
        { role: 'user', text: '[#m2 16:30] Caio: foi 2 a 1' },
      ],
    });

    expect(messages).toHaveLength(3);
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: '[#m2 16:30] Caio: foi 2 a 1\n[#m3 16:30] ➜ Ana: oi',
    });
  });

  it('explica como ler a transcrição: cabeçalho, marca, citação e mídia', () => {
    const { instructions } = buildPrompt(base);

    expect(instructions).toContain('[#m12 16:30] Nome: mensagem');
    expect(instructions).toContain('➜');
    expect(instructions).toContain('(respondendo #m9)');
    expect(instructions).toContain('[figurinha]');
  });

  it('a imagem vai como parte da última mensagem, sem mudar o sistema', () => {
    const data = new Uint8Array([1, 2, 3]);
    const { instructions, messages } = buildPrompt({
      ...base,
      image: { data, mediaType: 'image/webp' },
    });

    expect(instructions).toBe(buildPrompt(base).instructions);
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Ana: oi' },
        { type: 'file', data, mediaType: 'image/webp' },
      ],
    });
  });

  it('o sistema é idêntico entre turnos seguidos do mesmo chat', () => {
    const first = buildPrompt({ ...base, header: '[#m1 16:30]', today: 'domingo, 18/10/2026' });
    const next = buildPrompt({
      ...base,
      senderName: 'Bia',
      userText: 'e agora?',
      header: '[#m9 23:59]',
      today: 'segunda-feira, 19/10/2026',
      summary: 'Ana pediu pizza (#m1).',
      image: { data: new Uint8Array([1]), mediaType: 'image/png' },
      history: [
        { role: 'user', text: '[#m1 16:30] Ana: oi' },
        { role: 'assistant', text: 'oi!' },
      ],
    });

    expect(next.instructions).toBe(first.instructions);
  });

  it('o sistema fala sem caixa alta e sem "override"', () => {
    const plain = { ...persona, context: 'contexto', style: 'estilo', traits: ['traço'] };
    const { instructions } = buildPrompt({ ...base, persona: plain });

    expect(instructions).not.toMatch(/override/i);
    // `[PARTE]` é o separador dos balões, não ênfase.
    expect(instructions.replaceAll('[PARTE]', '')).not.toMatch(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}\b/);
  });

  it('o resumo abre a conversa como fala do usuário, junto da primeira se ela também é', () => {
    const withUser = buildPrompt({
      ...base,
      summary: 'Ana e Bia falavam do jogo (#m2).',
      history: [
        { role: 'user', text: '[#m5 16:29] Bia: e aí?' },
        { role: 'assistant', text: 'opa' },
      ],
    });
    const withLuma = buildPrompt({
      ...base,
      summary: 'resumo',
      history: [{ role: 'assistant', text: 'falei antes' }],
    });

    expect(withUser.messages[0]).toEqual({
      role: 'user',
      content:
        '[resumo da conversa até aqui]\nAna e Bia falavam do jogo (#m2).\n[#m5 16:29] Bia: e aí?',
    });
    expect(withUser.messages).toHaveLength(3);
    // A fala dela depois do resumo não é órfã: fica.
    expect(withLuma.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('não lista ferramentas pelo nome: elas chegam pelo ai.tools', () => {
    const { instructions } = buildPrompt(base);

    expect(instructions).not.toMatch(/create_sticker|schedule_reminder|search_web/);
  });
});

describe('quotedContext', () => {
  const quoted = (over: Partial<QuotedInfo>): QuotedInfo => ({
    text: 'texto citado',
    senderName: 'Bia',
    fromLuma: false,
    visual: null,
    ...over,
  });

  it('sem citação ou citação vazia, nada', () => {
    expect(quotedContext(null, undefined)).toBe('');
    expect(quotedContext(quoted({ text: null }), undefined)).toBe('');
  });

  it('citação de terceiro leva o autor', () => {
    expect(quotedContext(quoted({}), undefined)).toBe('[citando Bia: "texto citado"]');
    expect(quotedContext(quoted({ senderName: null }), undefined)).toBe(
      '[citando Alguém: "texto citado"]',
    );
  });

  it('citar a última fala dela, que já está no histórico, não acrescenta nada', () => {
    const q = quoted({ fromLuma: true, text: 'segunda parte' });
    expect(quotedContext(q, 'primeira parte\nsegunda parte')).toBe('');
  });

  it('citar outra fala dela vira "respondendo a esta sua mensagem"', () => {
    const q = quoted({ fromLuma: true, text: 'falei isso pra outro' });
    expect(quotedContext(q, 'resposta mais recente')).toBe(
      '[o usuário está respondendo a esta sua mensagem anterior: "falei isso pra outro"]',
    );
  });

  it('mídia visual: com e sem legenda, de terceiro e dela', () => {
    expect(quotedContext(quoted({ visual: 'imagem' }), undefined)).toBe(
      '[citando Bia: imagem com legenda "texto citado"]',
    );
    expect(quotedContext(quoted({ visual: 'figurinha', text: null }), undefined)).toBe(
      '[citando Bia: figurinha — analise visualmente]',
    );
    expect(quotedContext(quoted({ visual: 'imagem', fromLuma: true, text: null }), undefined)).toBe(
      '[o usuário está respondendo a uma imagem que você mandou — analise visualmente]',
    );
  });
});
