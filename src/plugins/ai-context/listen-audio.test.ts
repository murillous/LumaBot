import { MediaExpiredError } from '@usebridger/core';
import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted } from '#plugins/ai/testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai/tools-probe.ts';
import { aiContext } from './ai-context.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };

async function start(
  ear: ReturnType<typeof scripted>,
  contextConfig: Record<string, unknown> = { audioModels: [{ model: 'fake:o' }] },
) {
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: scripted('ok'), o: ear }), aiContext, aiToolsProbe],
    pluginConfig: {
      ai: { models: [{ model: 'fake:a' }] },
      'ai-context': contextConfig,
    },
  });
  return bot;
}

describe('listen_audio', () => {
  it('ouve áudios anteriores pelo ID, na cadeia de áudio, e devolve o que foi dito', async () => {
    const ear = scripted('#m1: "bora no rolê sábado"; #m2: "não posso"');
    const b = await start(ear);
    await b.receive({ voice: fixtures.voice(), chat: group, sender: { name: 'Ana' } });
    await b.receive({ audio: fixtures.audio(), chat: group, sender: { name: 'Bia' } });

    await b.receive({
      text: '!tool listen_audio {"ids":["#m1","m2"],"question":"quem topou?"}',
      chat: group,
    });

    expect(toolResult(b)).toEqual({
      ok: true,
      transcript: '#m1: "bora no rolê sábado"; #m2: "não posso"',
    });
    const prompt = promptText(ear);
    expect(prompt.match(/"type":"file"/g)).toHaveLength(2);
    expect(prompt).toContain('#m1 (áudio):');
    expect(prompt).toContain('#m2 (áudio):');
    expect(prompt).toContain('Pergunta: quem topou?');
  });

  it('sem audioModels, ouve na cadeia do contexto', async () => {
    const ear = scripted('oi gente');
    const b = await start(ear, { models: [{ model: 'fake:o' }] });
    await b.receive({ voice: fixtures.voice(), chat: group });

    await b.receive({ text: '!tool listen_audio {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: true, transcript: 'oi gente' });
  });

  it('recusa ID desconhecido, fala sem mídia e mídia que não é áudio, dizendo qual', async () => {
    const ear = scripted('x');
    const b = await start(ear);
    await b.receive({ text: 'oi', chat: group });
    await b.receive({ sticker: fixtures.sticker(), chat: group });

    await b.receive({ text: '!tool listen_audio {"ids":["m9"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'unknown', detail: 'm9' });
    await b.receive({ text: '!tool listen_audio {"ids":["m1"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'no-media', detail: 'm1' });
    await b.receive({ text: '!tool listen_audio {"ids":["m2"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'not-audio', detail: 'm2' });
    expect(ear.doGenerateCalls).toHaveLength(0);
  });

  it('áudio que saiu da plataforma volta como expired', async () => {
    const ear = scripted('x');
    const b = await start(ear);
    await b.receive({ voice: fixtures.voice(), chat: group });
    vi.spyOn(b.transport, 'mediaFromRef').mockReturnValue({
      download: () => Promise.reject(new MediaExpiredError('sumiu')),
      stream: () => Promise.reject(new MediaExpiredError('sumiu')),
    });

    await b.receive({ text: '!tool listen_audio {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'expired', detail: 'm1' });
    expect(ear.doGenerateCalls).toHaveLength(0);
  });

  it('áudio grande demais nem vai ao modelo', async () => {
    const ear = scripted('x');
    const b = await start(ear, {
      audioModels: [{ model: 'fake:o' }],
      maxAudioBytes: 10,
    });
    await b.receive({ voice: fixtures.voice(), chat: group });

    await b.receive({ text: '!tool listen_audio {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'too-large', detail: 'm1' });
    expect(ear.doGenerateCalls).toHaveLength(0);
  });

  it('desligada na config, a tool não é oferecida', async () => {
    const b = await start(scripted('x'), { disabledTools: ['listen_audio'] });
    await b.receive({ voice: fixtures.voice(), chat: group });

    await b.receive({ text: '!tool listen_audio {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toMatchObject({ ok: false, error: 'not-offered' });
  });
});
