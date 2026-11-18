import { type Capability, MediaExpiredError } from '@usebridger/core';
import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted } from '#plugins/ai/testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai/tools-probe.ts';
import { aiContext } from './ai-context.ts';
import { eco } from './testing.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };

async function start(
  vision: ReturnType<typeof scripted>,
  options: { capabilities?: Iterable<Capability> } = {},
) {
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: scripted('ok'), v: vision }), aiContext, aiToolsProbe],
    pluginConfig: {
      ai: { models: [{ model: 'fake:a' }] },
      'ai-context': { visionModels: [{ model: 'fake:v' }] },
    },
    ...options,
  });
  return bot;
}

describe('view_media', () => {
  it('olha figurinhas anteriores pelo ID, na cadeia de visão, e devolve a descrição', async () => {
    const vision = scripted('#m1: um homem careca de terno; #m2: um cara de academia');
    const b = await start(vision);
    await b.receive({ sticker: fixtures.sticker(), chat: group, sender: { name: 'Ana' } });
    await b.receive({ image: fixtures.image(), chat: group, sender: { name: 'Bia' } });

    await b.receive({
      text: '!tool view_media {"ids":["#m1","m2"],"question":"quem é o careca?"}',
      chat: group,
    });

    expect(toolResult(b)).toEqual({
      ok: true,
      description: '#m1: um homem careca de terno; #m2: um cara de academia',
    });
    const prompt = promptText(vision);
    expect(prompt.match(/"type":"file"/g)).toHaveLength(2);
    expect(prompt).toContain('#m1 (figurinha):');
    expect(prompt).toContain('#m2 (imagem):');
    expect(prompt).toContain('Pergunta: quem é o careca?');
  });

  it('recusa ID desconhecido, fala sem mídia e mídia que não é imagem, dizendo qual', async () => {
    const vision = scripted('x');
    const b = await start(vision);
    await b.receive({ text: 'oi', chat: group });
    await b.receive({ voice: fixtures.voice(), chat: group });

    await b.receive({ text: '!tool view_media {"ids":["m9"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'unknown', detail: 'm9' });
    await b.receive({ text: '!tool view_media {"ids":["m1"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'no-media', detail: 'm1' });
    await b.receive({ text: '!tool view_media {"ids":["m2"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'not-image', detail: 'm2' });
    expect(vision.doGenerateCalls).toHaveLength(0);
  });

  it('a ID de outro chat não vale', async () => {
    const b = await start(scripted('x'));
    await b.receive({ sticker: fixtures.sticker(), chat: group });

    await b.receive({ text: '!tool view_media {"ids":["m1"]}' });

    expect(toolResult(b)).toEqual({ ok: false, error: 'unknown', detail: 'm1' });
  });

  it('mídia que saiu da plataforma volta como expired', async () => {
    const vision = scripted('x');
    const b = await start(vision);
    await b.receive({ sticker: fixtures.sticker(), chat: group });
    vi.spyOn(b.transport, 'mediaFromRef').mockReturnValue({
      download: () => Promise.reject(new MediaExpiredError('sumiu')),
      stream: () => Promise.reject(new MediaExpiredError('sumiu')),
    });

    await b.receive({ text: '!tool view_media {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'expired', detail: 'm1' });
    expect(vision.doGenerateCalls).toHaveLength(0);
  });

  it('visualização única não fica guardada', async () => {
    const vision = scripted('x');
    const b = await start(vision);
    await b.receive({ image: fixtures.image(), isViewOnce: true, chat: group });

    await b.receive({ text: '!tool view_media {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'view-once', detail: 'm1' });
  });

  it('sem a capability media.ref, a mídia em memória ainda serve', async () => {
    const vision = scripted('uma figurinha');
    const b = await start(vision, {
      capabilities: ['send.text', 'quoted', 'media.download', 'send.sticker'],
    });
    await b.receive({ sticker: fixtures.sticker(), chat: group });

    await b.receive({ text: '!tool view_media {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: true, description: 'uma figurinha' });
  });
});

describe('na conversa', () => {
  it('o bot vê os IDs das mídias anteriores e sabe que pode usá-los', async () => {
    const model = scripted('junto já');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), aiContext, eco],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
    });
    await bot.receive({ sticker: fixtures.sticker(), chat: group, sender: { name: 'Ana' } });
    await bot.receive({ sticker: fixtures.sticker(), chat: group, sender: { name: 'Bia' } });

    await bot.receive({
      text: 'eco, junta a cabeça do cara da primeira figurinha no corpo do cara da segunda',
      chat: group,
      sender: { name: 'Caio' },
    });

    const prompt = promptText(model);
    expect(prompt).toMatch(/#m1 \d\d:\d\d\] Ana: \[figurinha\]/);
    expect(prompt).toMatch(/#m2 \d\d:\d\d\] Bia: \[figurinha\]/);
    expect(prompt).toContain('passe o ID dela às ferramentas');
    const tools = model.doGenerateCalls[0]?.tools ?? [];
    expect(tools.map((t) => t.name)).toContain('view_media');
  });
});
