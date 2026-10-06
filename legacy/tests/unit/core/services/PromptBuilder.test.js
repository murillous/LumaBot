import { describe, it, expect, vi } from 'vitest';

// Mocka LUMA_CONFIG com templates de sistema simples e previsíveis.
// Os novos templates NÃO têm placeholders de histórico nem de mensagem atual —
// esses viram turnos reais no array `contents`.
vi.mock('../../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    SYSTEM_PROMPT_TEMPLATE: [
      'CONTEXTO:{{PERSONALITY_CONTEXT}}',
      'ESTILO:{{PERSONALITY_STYLE}}',
      'TRAITS:{{PERSONALITY_TRAITS}}',
      'DATA:{{CURRENT_DATETIME}}',
      '{{GROUP_CONTEXT_PLACEHOLDER}}',
    ].join('\n'),

    SYSTEM_VISION_PROMPT_TEMPLATE: [
      '[VISÃO]CONTEXTO:{{PERSONALITY_CONTEXT}}',
      '{{GROUP_CONTEXT_PLACEHOLDER}}',
    ].join('\n'),
  },
}));

import { buildConversationRequest } from '../../../../src/core/services/PromptBuilder.js';

const DEFAULT_PERSONA = {
  context: 'Você é a Luma.',
  style:   'informal',
  traits:  ['seja amigável', 'seja direta'],
};

function build(overrides = {}) {
  return buildConversationRequest({
    userMessage:   'oi',
    historyTurns:  [],
    personaConfig: DEFAULT_PERSONA,
    senderName:    'Teste',
    ...overrides,
  });
}

// ── estrutura de retorno ───────────────────────────────────────────────────────

describe('buildConversationRequest — estrutura de retorno', () => {
  it('retorna { systemInstruction, contents }', () => {
    const result = build();
    expect(typeof result.systemInstruction).toBe('string');
    expect(Array.isArray(result.contents)).toBe(true);
  });

  it('contents termina com um turno "user" contendo a mensagem atual', () => {
    const { contents } = build({ userMessage: 'qual é a capital?', senderName: 'Maria' });
    const last = contents[contents.length - 1];
    expect(last.role).toBe('user');
    expect(last.parts[0].text).toBe('Maria: qual é a capital?');
  });
});

// ── instrução de sistema ───────────────────────────────────────────────────────

describe('buildConversationRequest — systemInstruction', () => {
  it('inclui persona (contexto, estilo, traits) e data', () => {
    const { systemInstruction } = build();
    expect(systemInstruction).toContain('Você é a Luma.');
    expect(systemInstruction).toContain('informal');
    expect(systemInstruction).toContain('- seja amigável');
    expect(systemInstruction).toContain('- seja direta');
    expect(systemInstruction).toContain('DATA:');
  });

  it('NÃO inclui a mensagem atual (ela vive em contents, não no sistema)', () => {
    const { systemInstruction } = build({ userMessage: 'mensagem secreta', senderName: 'X' });
    expect(systemInstruction).not.toContain('mensagem secreta');
  });

  it('inclui o groupContext rotulado como contexto ambiente quando fornecido', () => {
    const { systemInstruction } = build({ groupContext: 'discussão sobre futebol' });
    expect(systemInstruction).toContain('discussão sobre futebol');
    expect(systemInstruction).toContain('CONTEXTO AMBIENTE');
  });

  it('NÃO inclui bloco de grupo quando groupContext vazio', () => {
    const { systemInstruction } = build({ groupContext: '' });
    expect(systemInstruction).not.toContain('CONTEXTO AMBIENTE');
  });
});

// ── histórico como turnos reais ─────────────────────────────────────────────────

describe('buildConversationRequest — histórico multi-turn', () => {
  it('converte historyTurns em turnos com papel real antes da mensagem atual', () => {
    const historyTurns = [
      { role: 'user',  text: 'Ana: oi' },
      { role: 'model', text: 'olá!' },
    ];
    const { contents } = build({ historyTurns });

    expect(contents).toHaveLength(3); // 2 histórico + 1 atual
    expect(contents[0]).toEqual({ role: 'user',  parts: [{ text: 'Ana: oi' }] });
    expect(contents[1]).toEqual({ role: 'model', parts: [{ text: 'olá!' }] });
    expect(contents[2].role).toBe('user');
  });

  it('descarta turnos "model" órfãos no início (Gemini exige começar com user)', () => {
    const historyTurns = [
      { role: 'model', text: 'resposta órfã' },
      { role: 'user',  text: 'Ana: pergunta' },
      { role: 'model', text: 'resposta' },
    ];
    const { contents } = build({ historyTurns });

    expect(contents[0].role).toBe('user');
    expect(contents[0].parts[0].text).toBe('Ana: pergunta');
    // o turno órfão não deve aparecer
    expect(contents.some((c) => c.parts[0].text === 'resposta órfã')).toBe(false);
  });

  it('sem histórico, contents tem só a mensagem atual', () => {
    const { contents } = build({ historyTurns: [] });
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('user');
  });
});

// ── imageData / visão ──────────────────────────────────────────────────────────

describe('buildConversationRequest — modo visão (imageData)', () => {
  const imageData = { inlineData: { data: 'base64==', mimeType: 'image/jpeg' } };

  it('anexa imageData como segunda parte do turno atual', () => {
    const { contents } = build({ imageData });
    const last = contents[contents.length - 1];
    expect(last.parts).toHaveLength(2);
    expect(last.parts[1]).toEqual(imageData);
  });

  it('usa SYSTEM_VISION_PROMPT_TEMPLATE quando há imageData', () => {
    const { systemInstruction } = build({ imageData });
    expect(systemInstruction).toContain('[VISÃO]');
  });

  it('usa template normal (sem visão) quando não há imageData', () => {
    const { systemInstruction, contents } = build();
    expect(systemInstruction).not.toContain('[VISÃO]');
    expect(contents[contents.length - 1].parts).toHaveLength(1);
  });
});
