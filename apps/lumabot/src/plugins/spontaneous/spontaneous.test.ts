import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted } from '#plugins/ai-testing.ts';
import { luma } from '#plugins/luma/luma.ts';
import { spontaneous } from './spontaneous.ts';

let bot: TestBot | undefined;
beforeEach(() => {
  // Só o relógio: o cooldown depende de Date.now(); o resto (promises) segue real.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T12:00:00Z') });
});
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
  vi.useRealTimers();
});

const group = { id: 'grupo@fake', isGroup: true };

async function start(
  model: ReturnType<typeof scripted>,
  spontaneousConfig: Record<string, unknown> = {},
  more: NonNullable<Parameters<typeof createTestBot>[0]>['plugins'] = [],
) {
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: model }), spontaneous, ...(more ?? [])],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, spontaneous: spontaneousConfig },
  });
  return bot;
}

const say = (b: TestBot, text: string, name = 'Ana') =>
  b.receive({ text, chat: group, sender: { id: `${name}@x`, name } });

const reactions = (b: TestBot) => b.transport.reactions.map((r) => r.emoji);

describe('reação espontânea', () => {
  it('reage ao grupo com o emoji que a IA escolheu a partir do contexto', async () => {
    const model = scripted('💀');
    const b = await start(model);

    await say(b, 'perdi o ônibus de novo', 'Ana');

    await vi.waitFor(() => expect(reactions(b)).toEqual(['💀']));
    const prompt = promptText(model);
    expect(prompt).toContain('Ana: perdi o ônibus de novo');
    expect(prompt).toContain('😂 💀 😭');
  });

  it('a IA lê as mensagens anteriores do chat, da mais antiga à mais nova', async () => {
    const model = scripted('😂');
    const b = await start(model, { cooldownMs: 0 });

    await say(b, 'primeira', 'Ana');
    await say(b, 'segunda', 'Bia');
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(2));

    expect(promptText(model, 1)).toMatch(/Ana: primeira.*Bia: segunda/s);
  });

  it('"nenhuma" não reage', async () => {
    const model = scripted('nenhuma');
    const b = await start(model);

    await say(b, 'bom dia');
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(1));

    expect(reactions(b)).toEqual([]);
  });

  it('emoji fora da lista vale como "nenhuma"', async () => {
    const model = scripted('🔥');
    const b = await start(model);

    await say(b, 'bom dia');
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(1));
    await b.bot.settled();

    expect(reactions(b)).toEqual([]);
  });

  it('usa a lista de emojis da config', async () => {
    const model = scripted('🔥');
    const b = await start(model, { emojis: ['🔥'] });

    await say(b, 'esse bolo ficou ótimo');

    await vi.waitFor(() => expect(reactions(b)).toEqual(['🔥']));
  });

  it('nunca manda texto ou mídia, só reação', async () => {
    const model = scripted('😂');
    const b = await start(model);

    await say(b, 'kkkk');
    await vi.waitFor(() => expect(reactions(b)).toHaveLength(1));

    expect(b.sent).toHaveLength(0);
  });
});

describe('quando não age', () => {
  it('em conversa privada', async () => {
    const model = scripted('😂');
    const b = await start(model);

    await b.receive({ text: 'kkkk' });
    await b.bot.settled();

    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('em mensagem sem texto (mídia sem legenda)', async () => {
    const model = scripted('😂');
    const b = await start(model);

    await b.receive({ sticker: Buffer.from('x'), chat: group });
    await b.bot.settled();

    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('em mensagem de outro bot', async () => {
    const model = scripted('😂');
    const b = await start(model);

    await b.receive({ text: 'kkkk', chat: group, sender: { isBot: true } });
    await b.bot.settled();

    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('quando outro listener já reivindicou a mensagem', async () => {
    const luma = definePlugin({
      name: 'dona',
      version: '0.0.0',
      engine: '<1.0.0',
      setup: (ctx) => {
        ctx.events.on('message', (e) => e.claim());
      },
    });
    const model = scripted('😂');
    const b = await start(model, {}, [luma]);

    await say(b, 'luma, kkkk');
    await b.bot.settled();

    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('sem a capability de reações, nem chama a IA', async () => {
    const model = scripted('😂');
    bot = await createTestBot({
      profile: 'web',
      plugins: [ai, fakeProvider({ a: model }), spontaneous],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
    });

    await bot.receive({ text: 'kkkk', chat: group });
    await bot.bot.settled();

    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe('com a Luma', () => {
  it('quando a Luma responde, o espontâneo não avalia nem reage', async () => {
    const model = scripted('opa, tô aqui');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), luma, spontaneous],
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        luma: { thinkingDelayMs: { min: 0, max: 0 } },
      },
    });

    await say(bot, 'luma, tá aí?');
    await bot.bot.settled();

    expect(bot.sent).toHaveReplied('opa, tô aqui');
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(reactions(bot)).toEqual([]);
  });

  it('conversa que não é com a Luma segue para o espontâneo', async () => {
    const model = scripted('😂');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), luma, spontaneous],
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        luma: { thinkingDelayMs: { min: 0, max: 0 } },
      },
    });

    await say(bot, 'kkkkk olha isso');

    await vi.waitFor(() => expect(reactions(bot as TestBot)).toEqual(['😂']));
    expect(bot.sent).toHaveLength(0);
  });
});

describe('cooldown', () => {
  it('no máximo uma avaliação por chat a cada cooldownMs', async () => {
    const model = scripted('😂');
    const b = await start(model, { cooldownMs: 60_000 });

    await say(b, 'um');
    await say(b, 'dois');
    await say(b, 'três');
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(1));
    expect(model.doGenerateCalls).toHaveLength(1);

    vi.setSystemTime(Date.now() + 60_000);
    await say(b, 'quatro');
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(2));
  });

  it('o cooldown é por chat', async () => {
    const model = scripted('😂');
    const b = await start(model, { cooldownMs: 60_000 });

    await say(b, 'um');
    await b.receive({ text: 'dois', chat: { id: 'outro@fake', isGroup: true } });

    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(2));
  });

  it('a mensagem que não foi avaliada ainda entra no contexto da próxima', async () => {
    const model = scripted('nenhuma');
    const b = await start(model, { cooldownMs: 60_000 });

    await say(b, 'primeira');
    await say(b, 'segunda');
    vi.setSystemTime(Date.now() + 60_000);
    await say(b, 'terceira');
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(2));

    expect(promptText(model, 1)).toContain('Ana: segunda');
  });
});

describe('janela', () => {
  it('a IA lê no máximo `window` mensagens', async () => {
    const model = scripted('nenhuma');
    const b = await start(model, { window: 2, cooldownMs: 0 });

    for (const t of ['velha', 'meio', 'nova']) await say(b, t);
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(3));

    expect(promptText(model, 2)).not.toContain('velha');
    expect(promptText(model, 2)).toContain('meio');
  });
});

describe('falha da IA', () => {
  it('vai para o log e não derruba o listener: a próxima mensagem é avaliada', async () => {
    const err = new APICallError({
      message: 'fora',
      url: 'x',
      requestBodyValues: {},
      statusCode: 503,
    });
    const model = scripted(err, '😂');
    const b = await start(model, { cooldownMs: 0 });

    await say(b, 'um');
    await vi.waitFor(() => expect(model.doGenerateCalls).toHaveLength(1));
    await say(b, 'dois');

    await vi.waitFor(() => expect(reactions(b)).toEqual(['😂']));
  });

  it('sem cadeia configurada, não reage e não quebra', async () => {
    bot = await createTestBot({ plugins: [ai, spontaneous] });

    await bot.receive({ text: 'kkkk', chat: group });
    await bot.bot.settled();

    expect(reactions(bot)).toEqual([]);
  });
});

describe('cadeia própria', () => {
  it('usa `models` só para decidir a reação', async () => {
    const principal = scripted('da principal');
    const barata = scripted('😂');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ p: principal, b: barata }), spontaneous],
      pluginConfig: {
        ai: { models: [{ model: 'fake:p' }] },
        spontaneous: { models: [{ model: 'fake:b' }] },
      },
    });

    await say(bot, 'kkkk');

    await vi.waitFor(() => expect(reactions(bot as TestBot)).toEqual(['😂']));
    expect(principal.doGenerateCalls).toHaveLength(0);
  });
});
