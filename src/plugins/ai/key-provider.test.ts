import { createLogger, definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { aiAnthropic } from '#plugins/ai-anthropic/ai-anthropic.ts';
import { aiDeepseek } from '#plugins/ai-deepseek/ai-deepseek.ts';
import { aiGoogle } from '#plugins/ai-google/ai-google.ts';
import { aiOpenai } from '#plugins/ai-openai/ai-openai.ts';
import { type AiProvider, type AiService, ai } from './ai.ts';
import { keyProvider } from './key-provider.ts';

let bot: TestBot;

afterEach(async () => {
  await bot.stop();
});

const answer = {
  content: [{ type: 'text' as const, text: 'oi' }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
  warnings: [],
};

// Provider falso por chave: guarda com qual chave foi criado, como o SDK guardaria.
const usedKeys: string[] = [];
const fakeKeyed = keyProvider({
  plugin: 'ai-fake',
  version: '0.1.0',
  provider: { name: 'fake', label: 'Falso', models: [{ id: 'a' }] },
  create: (apiKey) => {
    usedKeys.push(apiKey);
    return { languageModel: () => new MockLanguageModelV4({ doGenerate: async () => answer }) };
  },
});

let listed: AiProvider[] = [];
let service: AiService | undefined;
const spy = (deps: Record<string, string>) =>
  definePlugin({
    name: 'spy',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0', ...deps },
    setup: (ctx) => {
      listed = [...ctx.services.extensionPoint('ai.providers').list()];
      service = ctx.services.get('ai');
    },
  });

const lines: string[] = [];
async function startFake(pluginConfig: Record<string, Record<string, unknown>>) {
  usedKeys.length = 0;
  lines.length = 0;
  bot = await createTestBot({
    logger: createLogger({ level: 'info', destination: { write: (l) => lines.push(l) } }),
    plugins: [ai, fakeKeyed, spy({ 'ai-fake': '^0.1.0' })],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, ...pluginConfig },
  });
  if (!service) throw new Error('serviço não capturado');
  return service;
}

const hi = { purpose: 'teste', messages: [{ role: 'user' as const, content: 'oi' }] };

describe('keyProvider', () => {
  it('com a chave da própria config, responde pela cadeia', async () => {
    const ai = await startFake({ 'ai-fake': { key: 'propria' } });

    expect((await ai.generate(hi)).text).toBe('oi');
    expect(usedKeys).toEqual(['propria']);
    expect(listed[0]?.key).toEqual({ plugin: 'ai-fake', path: 'key', configured: true });
  });

  it('sem chave própria, usa a que o ai ainda guarda em keys (legado)', async () => {
    const legacy = keyProvider({
      plugin: 'ai-google-falso',
      version: '0.1.0',
      provider: { name: 'google' },
      create: (apiKey) => {
        usedKeys.push(apiKey);
        return { languageModel: () => new MockLanguageModelV4({ doGenerate: async () => answer }) };
      },
    });
    usedKeys.length = 0;
    bot = await createTestBot({
      plugins: [ai, legacy],
      pluginConfig: { ai: { keys: { google: 'salva-antes' } } },
    });

    expect(usedKeys).toEqual(['salva-antes']);
  });

  it('a chave própria vence a do legado', async () => {
    await startFake({ 'ai-fake': { key: 'nova' }, ai: { keys: { google: 'velha' } } });

    expect(usedKeys).toEqual(['nova']);
  });

  it('sem chave: fica no catálogo marcado sem chave, avisa e sai da cadeia', async () => {
    const ai = await startFake({});

    expect(usedKeys).toEqual([]);
    expect(listed[0]).toMatchObject({
      name: 'fake',
      label: 'Falso',
      key: { plugin: 'ai-fake', path: 'key', configured: false },
    });
    expect(lines.some((l) => l.includes('ai-fake.key.missing'))).toBe(true);
    await expect(ai.generate(hi)).rejects.toThrow('nenhum modelo da cadeia respondeu');
  });

  it('nome que não é de provider antigo não acha chave no legado', async () => {
    await startFake({});

    expect(service?.legacyKey('constructor')).toBeUndefined();
  });
});

describe('providers por chave', () => {
  const all = { 'ai-google': '^0.1.0', 'ai-openai': '^0.1.0' };

  it('cada um contribui o próprio nome; só Google e OpenAI geram imagem', async () => {
    bot = await createTestBot({
      plugins: [ai, aiGoogle, aiOpenai, aiAnthropic, aiDeepseek, spy(all)],
      pluginConfig: {
        'ai-google': { key: 'g' },
        'ai-openai': { key: 'o' },
        'ai-anthropic': { key: 'a' },
        'ai-deepseek': { key: 'd' },
      },
    });

    const byName = Object.fromEntries(listed.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['anthropic', 'deepseek', 'google', 'openai']);
    expect(byName['google']?.imageModel).toBeTypeOf('function');
    expect(byName['openai']?.imageModel).toBeTypeOf('function');
    expect(byName['anthropic']?.imageModel).toBeUndefined();
    expect(byName['deepseek']?.imageModel).toBeUndefined();
    expect(byName['anthropic']?.temperature).toEqual({ min: 0, max: 1 });
  });

  it('um bot só com o ai-deepseek sobe e responde pelo deepseek', async () => {
    bot = await createTestBot({
      plugins: [ai, aiDeepseek, spy({ 'ai-deepseek': '^0.1.0' })],
      pluginConfig: { 'ai-deepseek': { key: 'd' } },
    });

    expect(listed.map((p) => p.name)).toEqual(['deepseek']);
    expect(listed[0]?.languageModel('deepseek-chat')).toMatchObject({ modelId: 'deepseek-chat' });
  });
});
