import { describe, it, expect, vi } from 'vitest';

// Mocka LUMA_CONFIG para tornar os testes independentes dos valores reais.
vi.mock('../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    TECHNICAL: {
      maxResponseLength: 500,
      maxParts: 3,
    },
  },
}));

import { cleanResponseText, splitIntoParts } from '../../../src/utils/ResponseFormatter.js';

// ── cleanResponseText ──────────────────────────────────────────────────────────

describe('cleanResponseText — limpeza de artefatos da IA', () => {
  it('retorna string vazia para null', () => {
    expect(cleanResponseText(null)).toBe('');
  });

  it('retorna string vazia para undefined', () => {
    expect(cleanResponseText(undefined)).toBe('');
  });

  it('retorna string vazia para texto vazio', () => {
    expect(cleanResponseText('')).toBe('');
  });

  it('remove bloco <think>...</think>', () => {
    const input    = '<think>pensamento interno</think>resposta final';
    expect(cleanResponseText(input)).toBe('resposta final');
  });

  it('remove bloco <think> multilinha', () => {
    const input = '<think>\nlinha1\nlinha2\n</think>resposta';
    expect(cleanResponseText(input)).toBe('resposta');
  });

  it('remove bloco <THINK> case-insensitive', () => {
    const input = '<THINK>algo</THINK>resultado';
    expect(cleanResponseText(input)).toBe('resultado');
  });

  it('remove prefixo "Luma: " no início da resposta', () => {
    expect(cleanResponseText('Luma: olá tudo bem?')).toBe('olá tudo bem?');
  });

  it('remove prefixo "luma: " case-insensitive', () => {
    expect(cleanResponseText('LUMA: resposta aqui')).toBe('resposta aqui');
  });

  it('não altera texto sem artefatos', () => {
    expect(cleanResponseText('texto normal')).toBe('texto normal');
  });

  it('faz trim do resultado', () => {
    expect(cleanResponseText('  texto com espaços  ')).toBe('texto com espaços');
  });

  it('remove <think> e prefixo Luma: juntos', () => {
    const input = '<think>raciocínio</think>Luma: resposta';
    expect(cleanResponseText(input)).toBe('resposta');
  });
});

// ── splitIntoParts ─────────────────────────────────────────────────────────────

describe('splitIntoParts — divisão de texto para envio sequencial', () => {
  it('retorna array vazio para texto vazio', () => {
    expect(splitIntoParts('')).toEqual([]);
  });

  it('retorna array vazio para null', () => {
    expect(splitIntoParts(null)).toEqual([]);
  });

  it('retorna array vazio para undefined', () => {
    expect(splitIntoParts(undefined)).toEqual([]);
  });

  it('retorna texto curto como parte única', () => {
    const text  = 'resposta curta';
    const parts = splitIntoParts(text, { maxLen: 500, maxParts: 3 });

    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(text);
  });

  it('divide pelo separador explícito [PARTE]', () => {
    const text  = 'primeiro[PARTE]segundo[PARTE]terceiro';
    const parts = splitIntoParts(text, { maxLen: 500, maxParts: 3 });

    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('primeiro');
    expect(parts[1]).toBe('segundo');
    expect(parts[2]).toBe('terceiro');
  });

  it('remove partes vazias ao dividir por [PARTE]', () => {
    const text  = 'bloco um[PARTE][PARTE]bloco três';
    const parts = splitIntoParts(text, { maxLen: 500, maxParts: 3 });

    expect(parts.every(p => p.length > 0)).toBe(true);
  });

  it('respeita o limite máximo de partes', () => {
    const text  = 'a[PARTE]b[PARTE]c[PARTE]d[PARTE]e';
    const parts = splitIntoParts(text, { maxLen: 500, maxParts: 3 });

    expect(parts.length).toBeLessThanOrEqual(3);
  });

  it('texto longo sem [PARTE] é dividido em ponto natural', () => {
    const long  = 'a'.repeat(200) + '. ' + 'b'.repeat(200) + '. ' + 'c'.repeat(200);
    const parts = splitIntoParts(long, { maxLen: 300, maxParts: 3 });

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.length > 0)).toBe(true);
  });

  it('nenhuma parte individualmente excede maxLen (com margem para quebra em palavra)', () => {
    const long  = 'palavra '.repeat(200); // ~1600 chars
    const parts = splitIntoParts(long, { maxLen: 300, maxParts: 3 });

    parts.forEach(p => {
      expect(p.length).toBeLessThanOrEqual(400); // 300 + margem de quebra
    });
  });

  it('usa valores padrão de LUMA_CONFIG quando não passados', () => {
    const text  = 'texto curto';
    const parts = splitIntoParts(text);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(text);
  });
});
