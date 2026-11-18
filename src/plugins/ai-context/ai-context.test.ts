import { createMemoryStorage, definePlugin, type StoragePort } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted, toolAnswer } from '#plugins/ai-testing.ts';
import { auditReader } from '#plugins/audit-reader.ts';
import { luma } from '#plugins/luma/luma.ts';
import { aiContext } from './ai-context.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };

/** Um bot qualquer, que não é a Luma: responde pelo `respond` quando a fala começa com "eco". */
const eco = definePlugin({
  name: 'eco',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { 'ai-context': '^0.1.0' },
  setup: (ctx) => {
    ctx.events.on('message', async (e) => {
      if (!e.text?.toLowerCase().startsWith('eco')) return;
      await ctx.services.get('aiContext').respond({
        message: e.message,
        reply: e.reply,
        signal: e.signal,
        log: e.log,
        instructions: '# Quem você é\nVocê é o Eco.',
        name: 'Eco',
      });
    });
  },
});

async function start(
  model: ReturnType<typeof scripted>,
  extra: Parameters<typeof createTestBot>[0] = {},
) {
  bot = await createTestBot({
    ...extra,
    plugins: [ai, fakeProvider({ a: model }), aiContext, eco, ...(extra.plugins ?? [])],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, ...extra.pluginConfig },
  });
  return bot;
}

const system = (model: ReturnType<typeof scripted>, call = 0) =>
  JSON.stringify(model.doGenerateCalls[call]?.prompt.filter((m) => m.role === 'system'));

describe('respond', () => {
  it('outro bot responde com a transcrição do chat, o guia de leitura e a memória', async () => {
    const model = scripted('oi, Bia');
    const b = await start(model);
    await b.receive({ text: 'bom dia, pessoal', chat: group, sender: { name: 'Ana' } });

    await b.receive({
      text: 'eco, quem falou antes de mim?',
      chat: group,
      sender: { name: 'Bia' },
    });

    expect(b.sent).toHaveReplied('oi, Bia');
    const prompt = promptText(model);
    expect(prompt).toMatch(/\[#m1 \d\d:\d\d\] Ana: bom dia, pessoal/);
    expect(prompt).toMatch(/\[#m2 \d\d:\d\d\] ➜ Bia: eco, quem falou antes de mim\?/);
    expect(prompt).toMatch(/\[hoje é [^\]]+\]/);
    expect(system(model)).toContain('Você é o Eco.');
    expect(system(model)).toContain('# Como ler a conversa');
    expect(system(model)).toContain('# Memória');
    // A fala de agora entra uma vez só, embora o ai-context e o eco a observem.
    expect(prompt.match(/eco, quem falou antes de mim/g)).toHaveLength(1);
  });

  it('grava a resposta: a próxima fala vê o turno do bot', async () => {
    const model = scripted('sou o eco', 'de novo');
    const b = await start(model);
    await b.receive({ text: 'eco, quem é você?' });

    await b.receive({ text: 'eco, e agora?' });

    const prompt = model.doGenerateCalls[1]?.prompt ?? [];
    expect(prompt.find((m) => m.role === 'assistant')).toMatchObject({
      content: [{ type: 'text', text: 'sou o eco' }],
    });
    expect(promptText(model, 1)).toMatch(/\[#m3 \d\d:\d\d\] ➜ Usuário: eco, e agora\?/);
  });

  it('oferece as tools de contexto, e o clear_history audita com o nome do plugin', async () => {
    const reader = auditReader();
    const model = scripted(toolAnswer('clear_history', {}), 'esqueci');
    const b = await start(model, {
      plugins: [reader.plugin],
      adminPlugins: [reader.plugin.name],
    });

    await b.receive({ text: 'eco, esquece tudo', chat: group });

    const tools = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(['read_messages', 'remember', 'forget', 'clear_history']),
    );
    const [event] = await reader.events('ai-context.history.clear');
    expect(event?.target).toEqual({ type: 'chat', id: 'grupo@fake' });
  });
});

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
