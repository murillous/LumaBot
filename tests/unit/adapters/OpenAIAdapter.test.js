import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted garante que create está disponível antes do vi.mock (ESM hoisting)
const create = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'resposta mock', tool_calls: [] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  })
);

vi.mock('openai', () => ({
  default: class OpenAI {
    constructor() {
      this.chat = { completions: { create } };
    }
  },
}));

const { OpenAIAdapter } = await import('../../../src/adapters/ai/OpenAIAdapter.js');

function makeAdapter() {
  return new OpenAIAdapter({ apiKey: 'sk-fake', model: 'gpt-4o-mini' });
}

beforeEach(() => vi.clearAllMocks());

describe('OpenAIAdapter — construtor', () => {
  it('lança erro se apiKey não for fornecida', () => {
    expect(() => new OpenAIAdapter({})).toThrow('apiKey');
  });

  it('cria instância com apiKey válida', () => {
    expect(() => makeAdapter()).not.toThrow();
  });
});

describe('OpenAIAdapter.generateContent', () => {
  it('chama create com messages formatadas corretamente', async () => {
    const adapter = makeAdapter();
    const history = [
      { role: 'user',  parts: [{ text: 'oi' }] },
      { role: 'model', parts: [{ text: 'olá!' }] },
    ];

    await adapter.generateContent(history, 'Você é a Luma.');

    const call = create.mock.calls[0][0];
    expect(call.messages[0]).toEqual({ role: 'system',    content: 'Você é a Luma.' });
    expect(call.messages[1]).toEqual({ role: 'user',      content: 'oi' });
    expect(call.messages[2]).toEqual({ role: 'assistant', content: 'olá!' });
  });

  it('retorna { text, functionCalls } no formato interno', async () => {
    const adapter = makeAdapter();
    const result  = await adapter.generateContent([], 'system');

    expect(result).toHaveProperty('text', 'resposta mock');
    expect(Array.isArray(result.functionCalls)).toBe(true);
  });

  it('extrai tool_calls quando presentes', async () => {
    create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            function: { name: 'tag_everyone', arguments: '{"target":"all"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const result = await makeAdapter().generateContent([], 'system');
    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0]).toEqual({ name: 'tag_everyone', args: { target: 'all' } });
  });

  it('inclui tools convertidas quando fornecidas', async () => {
    const tools = [{ name: 'fn', description: 'desc', parameters: { type: 'object' } }];
    await makeAdapter().generateContent([], 'system', tools);

    const call = create.mock.calls[0][0];
    expect(call.tools).toBeDefined();
    expect(call.tools[0].type).toBe('function');
    expect(call.tools[0].function.name).toBe('fn');
  });

  it('não inclui tools quando lista vazia', async () => {
    await makeAdapter().generateContent([], 'system', []);
    const call = create.mock.calls[0][0];
    expect(call.tools).toBeUndefined();
  });
});

describe('OpenAIAdapter.processMedia', () => {
  it('envia prompt + imagem no formato image_url', async () => {
    const media = [{ mimeType: 'image/jpeg', data: Buffer.from('fake') }];
    await makeAdapter().processMedia('descreva', media);

    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'descreva' });
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('retorna string com a resposta', async () => {
    const result = await makeAdapter().processMedia('prompt', []);
    expect(typeof result).toBe('string');
  });
});

describe('OpenAIAdapter.getStats', () => {
  it('acumula calls e tokens após generateContent', async () => {
    const adapter = makeAdapter();
    await adapter.generateContent([], 'system');
    const stats = adapter.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.tokensIn).toBe(10);
    expect(stats.tokensOut).toBe(5);
  });

  it('retorna cópia — mutação externa não afeta estado interno', () => {
    const adapter = makeAdapter();
    const stats   = adapter.getStats();
    stats.calls   = 999;
    expect(adapter.getStats().calls).toBe(0);
  });
});
