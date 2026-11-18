import { definePlugin } from '@usebridger/core';
import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted, toolAnswer } from '#plugins/ai/testing.ts';
import { aiContext } from './ai-context.ts';
import { auditReader, eco } from './testing.ts';
import { DEFAULT_TEXTS } from './texts.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };

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

describe('ai-context.names', () => {
  const namer = (resolve: (id: string) => Promise<string>) =>
    definePlugin({
      name: 'namer',
      version: '0.0.0',
      engine: '<1.0.0',
      setup: (ctx) => {
        ctx.services.contribute('ai-context.names', resolve);
      },
    });

  it('o nome de quem fala vem de quem contribui no ponto', async () => {
    const model = scripted('oi');
    const b = await start(model, { plugins: [namer(async () => 'Aninha')] });

    await b.receive({ text: 'eco, oi', sender: { name: 'Ana Paula' } });

    expect(promptText(model)).toMatch(/Aninha: eco, oi/);
    expect(promptText(model)).not.toContain('Ana Paula');
  });

  it('sem ninguém no ponto, ou se ele falha, vale o nome do perfil', async () => {
    const model = scripted('oi');
    const b = await start(model, {
      plugins: [
        namer(async () => {
          throw new Error('sem banco');
        }),
      ],
    });

    await b.receive({ text: 'eco, oi', sender: { name: 'Ana Paula' } });

    expect(promptText(model)).toMatch(/Ana Paula: eco, oi/);
  });
});

describe('genérico', () => {
  /** Um bot em inglês: o nome vem da config do ai-context, não do pedido. */
  const echo = definePlugin({
    name: 'echo',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { 'ai-context': '^0.1.0' },
    setup: (ctx) => {
      ctx.events.on('message', async (e) => {
        if (!e.text?.toLowerCase().startsWith('echo')) return;
        await ctx.services.get('aiContext').respond({
          message: e.message,
          reply: e.reply,
          signal: e.signal,
          log: e.log,
          instructions: '# Who you are\nYou are Echo.',
        });
      });
    },
  });

  /** Cada texto vira `«chave»`, com os mesmos placeholders: nada do padrão em PT sobra. */
  const english = Object.fromEntries(
    Object.entries(DEFAULT_TEXTS).map(([key, text]) => [
      key,
      [`«${key}»`, ...(text.match(/\{\w+\}/g) ?? [])].join(' '),
    ]),
  );

  async function startEcho(
    model: ReturnType<typeof scripted>,
    context: Readonly<Record<string, unknown>>,
  ) {
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), aiContext, echo],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, 'ai-context': context },
    });
    return bot;
  }

  it('com outro nome e outro idioma, só pela config, o prompt não tem Luma, WhatsApp nem PT', async () => {
    const model = scripted('hi');
    const b = await startEcho(model, { name: 'Echo', locale: 'en-US', messages: english });
    await b.receive({ sticker: fixtures.sticker(), chat: group, sender: { name: 'Ann' } });
    await b.receive({ text: 'echo, what was that?', chat: group, sender: { name: 'Bob' } });

    const call = model.doGenerateCalls[0];
    const sent = JSON.stringify({ prompt: call?.prompt, tools: call?.tools });
    expect(sent).toContain('«readingGuide» Echo');
    expect(sent).toContain('«mediaSticker»');
    expect(sent).toMatch(/«todayLine» (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
    expect(sent).toMatch(/\[#m1 \d\d:\d\d (AM|PM)\] Ann/);
    expect(sent).not.toMatch(/Luma|WhatsApp/);
    // Nenhum texto padrão chega ao modelo, nem português fixo no código.
    for (const text of Object.values(DEFAULT_TEXTS)) {
      expect(sent).not.toContain(text.slice(0, 24));
    }
    expect(sent).not.toMatch(
      /\b(você|que|uma|para|deste|desta|não|com|das|dos|conversa|mensagem|figurinha|hoje)\b/i,
    );
  });

  it('sobe com a config vazia e o contexto completo', async () => {
    const model = scripted('oi');
    const b = await startEcho(model, {});
    await b.receive({ text: 'echo, oi' });

    const tools = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining([
        'read_messages',
        'view_media',
        'read_pdf',
        'remember',
        'forget',
        'clear_history',
      ]),
    );
    expect(system(model)).toContain('# Como ler a conversa');
    expect(system(model)).toContain('# Memória');
  });

  it('memória desligada: sem a seção no sistema e sem lembrar nem esquecer', async () => {
    const model = scripted('oi');
    const b = await startEcho(model, { memory: { enabled: false } });
    await b.receive({ text: 'echo, oi' });

    const tools = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name);
    expect(tools).not.toContain('remember');
    expect(tools).not.toContain('forget');
    expect(tools).toContain('read_messages');
    expect(system(model)).not.toContain('# Memória');
  });

  it('cada tool pode ser desligada', async () => {
    const model = scripted('oi');
    const b = await startEcho(model, { disabledTools: ['read_pdf', 'clear_history'] });
    await b.receive({ text: 'echo, oi' });

    const tools = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name);
    expect(tools).not.toContain('read_pdf');
    expect(tools).not.toContain('clear_history');
    expect(tools).toContain('view_media');
  });
});
