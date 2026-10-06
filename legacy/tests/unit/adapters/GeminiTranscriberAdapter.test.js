import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiTranscriberAdapter } from '../../../src/adapters/transcriber/GeminiTranscriberAdapter.js';
import { TranscriberPort } from '../../../src/core/ports/TranscriberPort.js';

// Variável de módulo para reconfigurar por teste
let mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: (...args) => mockGenerateContent(...args),
      };
    }
  },
}));

vi.mock('../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    TECHNICAL: {
      models: ['gemini-flash'],
    },
  },
}));

function makeResponse(text) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

describe('GeminiTranscriberAdapter — construção', () => {
  it('instancia corretamente com apiKey', () => {
    const adapter = new GeminiTranscriberAdapter({ apiKey: 'key' });
    expect(adapter).toBeInstanceOf(GeminiTranscriberAdapter);
    expect(adapter).toBeInstanceOf(TranscriberPort);
  });

  it('lança erro se apiKey não for fornecida', () => {
    expect(() => new GeminiTranscriberAdapter({})).toThrow(
      'GeminiTranscriberAdapter: apiKey é obrigatória.'
    );
  });

  it('usa modelos do LUMA_CONFIG por padrão', () => {
    const adapter = new GeminiTranscriberAdapter({ apiKey: 'key' });
    expect(adapter.models).toEqual(['gemini-flash']);
  });

  it('aceita modelos customizados', () => {
    const adapter = new GeminiTranscriberAdapter({ apiKey: 'key', models: ['gemini-nano'] });
    expect(adapter.models).toEqual(['gemini-nano']);
  });
});

describe('GeminiTranscriberAdapter — transcribe', () => {
  let adapter;

  beforeEach(() => {
    mockGenerateContent = vi.fn();
    adapter = new GeminiTranscriberAdapter({ apiKey: 'key', models: ['gemini-flash'] });
  });

  it('retorna texto transcrito em caso de sucesso', async () => {
    mockGenerateContent.mockResolvedValue(makeResponse('Olá, tudo bem?'));
    const result = await adapter.transcribe(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBe('Olá, tudo bem?');
  });

  it('retorna null quando todos os modelos falham', async () => {
    mockGenerateContent.mockRejectedValue(new Error('falha'));
    const result = await adapter.transcribe(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBeNull();
  });

  it('retorna null quando a resposta está vazia', async () => {
    mockGenerateContent.mockResolvedValue(makeResponse(''));
    const result = await adapter.transcribe(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBeNull();
  });

  it('retorna "[áudio ininteligível]" quando o modelo retorna esse valor', async () => {
    mockGenerateContent.mockResolvedValue(makeResponse('[áudio ininteligível]'));
    const result = await adapter.transcribe(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBe('[áudio ininteligível]');
  });

  it('retorna "[áudio sem conteúdo]" quando o modelo retorna esse valor', async () => {
    mockGenerateContent.mockResolvedValue(makeResponse('[áudio sem conteúdo]'));
    const result = await adapter.transcribe(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBe('[áudio sem conteúdo]');
  });

  it('tenta o segundo modelo se o primeiro falhar', async () => {
    adapter = new GeminiTranscriberAdapter({ apiKey: 'key', models: ['flash', 'pro'] });
    mockGenerateContent
      .mockRejectedValueOnce(new Error('modelo indisponível'))
      .mockResolvedValueOnce(makeResponse('texto transcrito'));

    const result = await adapter.transcribe(Buffer.from('audio'), 'audio/ogg');
    expect(result).toBe('texto transcrito');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('envia o áudio como base64 inlineData', async () => {
    mockGenerateContent.mockResolvedValue(makeResponse('ok'));
    const audioBuffer = Buffer.from('fake-audio-data');
    await adapter.transcribe(audioBuffer, 'audio/ogg');

    const callArgs = mockGenerateContent.mock.calls[0][0];
    const inlineData = callArgs.contents[0].parts[0].inlineData;
    expect(inlineData.data).toBe(audioBuffer.toString('base64'));
  });
});

describe('GeminiTranscriberAdapter — _normalizeMimeType', () => {
  let adapter;

  beforeEach(() => {
    adapter = new GeminiTranscriberAdapter({ apiKey: 'key' });
  });

  it('normaliza "audio/ogg; codecs=opus" para "audio/ogg"', () => {
    expect(adapter._normalizeMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg');
  });

  it('normaliza "audio/mpeg" para "audio/mp3"', () => {
    expect(adapter._normalizeMimeType('audio/mpeg')).toBe('audio/mp3');
  });

  it('normaliza "audio/mp4" para "audio/mp4"', () => {
    expect(adapter._normalizeMimeType('audio/mp4')).toBe('audio/mp4');
  });

  it('normaliza "audio/aac" para "audio/aac"', () => {
    expect(adapter._normalizeMimeType('audio/aac')).toBe('audio/aac');
  });

  it('normaliza "audio/wav" para "audio/wav"', () => {
    expect(adapter._normalizeMimeType('audio/wav')).toBe('audio/wav');
  });

  it('normaliza "audio/webm" para "audio/webm"', () => {
    expect(adapter._normalizeMimeType('audio/webm')).toBe('audio/webm');
  });

  it('retorna "audio/ogg" como fallback para tipo desconhecido', () => {
    expect(adapter._normalizeMimeType('audio/flac')).toBe('audio/ogg');
  });

  it('retorna "audio/ogg" para null/undefined', () => {
    expect(adapter._normalizeMimeType(null)).toBe('audio/ogg');
    expect(adapter._normalizeMimeType(undefined)).toBe('audio/ogg');
  });

  it('é case-insensitive', () => {
    expect(adapter._normalizeMimeType('AUDIO/OGG')).toBe('audio/ogg');
  });
});
