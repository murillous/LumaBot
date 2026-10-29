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
  it('põe a persona, a data no fuso e o formato na instrução de sistema', () => {
    const { instructions } = buildPrompt(base);

    expect(instructions).toContain(persona.context);
    expect(instructions).toContain(persona.style);
    for (const trait of persona.traits) expect(instructions).toContain(`- ${trait}`);
    // 19:30 UTC é 16:30 em Brasília.
    expect(instructions).toMatch(/domingo, 18 de outubro de 2026.*16:30/);
    expect(instructions).toContain('[PARTE]');
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

  it('o contexto do grupo entra rotulado como ambiente, só quando há', () => {
    expect(buildPrompt(base).instructions).not.toContain('CONTEXTO AMBIENTE');

    const { instructions } = buildPrompt({ ...base, groupContext: 'Bia: bom dia' });
    expect(instructions).toContain('[CONVERSA DO GRUPO — CONTEXTO AMBIENTE]');
    expect(instructions).toContain('NÃO foi endereçado a você');
    expect(instructions).toContain('Bia: bom dia');
  });

  it('a imagem vai como parte da última mensagem e muda a instrução', () => {
    const data = new Uint8Array([1, 2, 3]);
    const { instructions, messages } = buildPrompt({
      ...base,
      image: { data, mediaType: 'image/webp' },
    });

    expect(instructions).toContain('[IMAGEM]');
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Ana: oi' },
        { type: 'file', data, mediaType: 'image/webp' },
      ],
    });
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
