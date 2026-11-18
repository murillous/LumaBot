// A Luma sobre o `ai-context`: a migração da memória que ela guardava e os textos do contexto.

import { createMemoryStorage, type StoragePort } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, scripted } from '#plugins/ai/testing.ts';
import { aiContext } from '#plugins/ai-context/ai-context.ts';
import { luma } from './luma.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };

const system = (model: ReturnType<typeof scripted>, call = 0) =>
  JSON.stringify(model.doGenerateCalls[call]?.prompt.filter((m) => m.role === 'system'));

describe('memória da Luma', () => {
  const fact = (text: string) => ({
    chatId: 'grupo@fake',
    about: '',
    name: '',
    text,
    at: Date.now(),
  });

  async function withLuma(storage: StoragePort, model: ReturnType<typeof scripted>) {
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), aiContext, luma],
      storage,
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        luma: { thinkingDelayMs: { min: 0, max: 0 } },
      },
    });
    return bot;
  }

  it('os fatos guardados pela Luma passam para o ai-context no boot', async () => {
    const storage = createMemoryStorage();
    await storage.forNamespace('luma').collection('memory').insert(fact('o grupo é do futebol'));
    const model = scripted('oi');
    const b = await withLuma(storage, model);

    await b.receive({ text: 'luma, oi', chat: group });

    expect(system(model)).toContain('- o grupo é do futebol');
    expect(await storage.forNamespace('luma').collection('memory').find({})).toHaveLength(0);
    expect(await storage.forNamespace('ai-context').collection('memory').find({})).toHaveLength(1);
  });

  it('migração repetida não duplica o fato', async () => {
    const storage = createMemoryStorage();
    await storage
      .forNamespace('ai-context')
      .collection('memory')
      .insert(fact('o grupo é do futebol'));
    // Sobrou na Luma: a migração anterior caiu entre gravar aqui e apagar lá.
    await storage.forNamespace('luma').collection('memory').insert(fact('o grupo é do futebol'));

    await withLuma(storage, scripted('oi'));

    expect(await storage.forNamespace('ai-context').collection('memory').find({})).toHaveLength(1);
    expect(await storage.forNamespace('luma').collection('memory').find({})).toHaveLength(0);
  });
});

describe('textos', () => {
  it('a Luma lê a conversa com os textos do ai-context', async () => {
    const model = scripted('oi');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), aiContext, luma],
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        'ai-context': { messages: { readingGuide: '# Leitura própria do {name}' } },
        luma: { thinkingDelayMs: { min: 0, max: 0 } },
      },
    });

    await bot.receive({ text: 'oi' });

    expect(system(model)).toContain('# Leitura própria do Luma');
    expect(system(model)).not.toContain('# Como ler a conversa');
  });
});
