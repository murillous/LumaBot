import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Testes de caracterização do AudioTranscriber.
 *
 * Testa _normalizeMimeType (função pura interna) e o comportamento
 * geral da transcrição com o cliente Gemini mockado.
 *
 * Não fazemos chamadas reais à API — o custo e a latência são
 * incompatíveis com uma suite de testes rápida.
 */

/**
 * Função de mock controlável por teste.
 * Exposta no escopo do módulo para que cada teste possa reconfigurá-la
 * sem precisar re-mockar o módulo inteiro.
 */
let mockGenerateContent = vi.fn();

/**
 * Mock do SDK usando class syntax — obrigatório no Vitest 4 para
 * que `new GoogleGenAI(...)` funcione corretamente (arrow functions
 * não funcionam como construtores e geram warning).
 */
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      // Delega para a função de mock do escopo externo,
      // permitindo reconfigurá-la por teste sem re-hoisting.
      this.models = {
        generateContent: (...args) => mockGenerateContent(...args),
      };
    }
  },
}));

import { AudioTranscriber } from '../../src/services/AudioTranscriber.js';

describe('AudioTranscriber._normalizeMimeType — normalização de MIME', () => {
  let transcriber;

  beforeEach(() => {
    // Reseta o mock para evitar vazamento de estado entre testes
    mockGenerateContent = vi.fn();
    transcriber = new AudioTranscriber('fake_key');
  });

  it('normaliza "audio/ogg; codecs=opus" para "audio/ogg"', () => {
    expect(transcriber._normalizeMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg');
  });

  it('normaliza "audio/mpeg" para "audio/mp3"', () => {
    expect(transcriber._normalizeMimeType('audio/mpeg')).toBe('audio/mp3');
  });

  it('normaliza "audio/mp4" para "audio/mp4"', () => {
    expect(transcriber._normalizeMimeType('audio/mp4')).toBe('audio/mp4');
  });

  it('normaliza "audio/aac" para "audio/aac"', () => {
    expect(transcriber._normalizeMimeType('audio/aac')).toBe('audio/aac');
  });

  it('retorna "audio/ogg" como fallback para tipo desconhecido', () => {
    expect(transcriber._normalizeMimeType('audio/unknown')).toBe('audio/ogg');
  });

  it('retorna "audio/ogg" quando mimeType é null', () => {
    expect(transcriber._normalizeMimeType(null)).toBe('audio/ogg');
  });

  it('retorna "audio/ogg" quando mimeType é undefined', () => {
    expect(transcriber._normalizeMimeType(undefined)).toBe('audio/ogg');
  });

  it('é case insensitive para o tipo base', () => {
    expect(transcriber._normalizeMimeType('Audio/OGG; codecs=opus')).toBe('audio/ogg');
  });
});

describe('AudioTranscriber.transcribe — comportamento geral', () => {
  beforeEach(() => {
    mockGenerateContent = vi.fn();
  });

  it('lança erro se API Key não for fornecida no construtor', () => {
    expect(() => new AudioTranscriber(null)).toThrow('API Key não fornecida');
    expect(() => new AudioTranscriber('')).toThrow('API Key não fornecida');
  });

  it('retorna null quando todos os modelos falham', async () => {
    // Todos os modelos do fallback devem lançar erro
    mockGenerateContent.mockRejectedValue(new Error('API indisponível'));

    const transcriber = new AudioTranscriber('fake_key');
    const result = await transcriber.transcribe(Buffer.from('audio'), 'audio/ogg');

    expect(result).toBeNull();
  });

  it('retorna o texto transcrito quando o modelo responde com sucesso', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{ text: 'transcrição do áudio aqui' }],
        },
      }],
    });

    const transcriber = new AudioTranscriber('fake_key');
    const result = await transcriber.transcribe(Buffer.from('audio'), 'audio/ogg');

    expect(result).toBe('transcrição do áudio aqui');
  });

  it('tenta o próximo modelo quando o primeiro falha', async () => {
    let callCount = 0;
    mockGenerateContent.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('Primeiro modelo falhou');
      return Promise.resolve({
        candidates: [{
          content: { parts: [{ text: 'segunda tentativa funcionou' }] },
        }],
      });
    });

    const transcriber = new AudioTranscriber('fake_key');
    const result = await transcriber.transcribe(Buffer.from('audio'), 'audio/ogg');

    expect(result).toBe('segunda tentativa funcionou');
    expect(callCount).toBe(2);
  });
});

describe('AudioTranscriber._extractText — extração de texto da resposta', () => {
  let transcriber;

  beforeEach(() => {
    mockGenerateContent = vi.fn();
    transcriber = new AudioTranscriber('fake_key');
  });

  it('extrai texto de resposta no formato candidates/content/parts', () => {
    const response = {
      candidates: [{
        content: {
          parts: [{ text: 'parte 1 ' }, { text: 'parte 2' }],
        },
      }],
    };

    expect(transcriber._extractText(response)).toBe('parte 1 parte 2');
  });

  it('retorna string vazia para resposta sem candidates', () => {
    expect(transcriber._extractText({})).toBe('');
  });

  it('ignora partes sem texto (ex: functionCall)', () => {
    const response = {
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'foo' } }, { text: 'texto real' }],
        },
      }],
    };

    expect(transcriber._extractText(response)).toBe('texto real');
  });
});
