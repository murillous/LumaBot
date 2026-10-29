import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, scripted } from '#plugins/ai-testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { observedBot } from '#plugins/observe-probe.ts';
import { audioMediaType, SILENT, transcribe, UNINTELLIGIBLE } from './transcribe.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

async function start(
  model: ReturnType<typeof scripted>,
  transcribeConfig: Record<string, unknown> = {},
  extra: Record<string, ReturnType<typeof scripted>> = {},
) {
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: model, ...extra }), transcribe, aiToolsProbe],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, transcribe: transcribeConfig },
  });
  return bot;
}

describe('!transcribe', () => {
  it('transcreve o áudio da própria mensagem e responde com o texto', async () => {
    const model = scripted('oi gente, tudo bem?');
    const b = await start(model);

    await b.receive({ text: '!transcribe', voice: fixtures.voice() });

    expect(b.sent).toHaveReplied('🎙️ "oi gente, tudo bem?"');
    const user = model.doGenerateCalls[0]?.prompt.at(-1);
    expect(JSON.stringify(user)).toContain('"mediaType":"audio/ogg"');
    expect(JSON.stringify(user)).toContain('Transcreva exatamente');
  });

  it('!t transcreve o áudio da mensagem citada, de voz ou arquivo de áudio', async () => {
    const b = await start(scripted('um', 'dois'));

    await b.receive({ text: '!t', quoted: { voice: fixtures.voice() } });
    await b.receive({ text: '!t', quoted: { audio: fixtures.audio() } });

    expect(b.sent).toContainText('🎙️ "um"');
    expect(b.sent).toContainText('🎙️ "dois"');
  });

  it('sem áudio, explica como usar', async () => {
    const model = scripted('x');
    const b = await start(model);

    await b.receive({ text: '!transcribe' });
    await b.receive({ text: '!t', quoted: { text: 'só texto' } });

    expect(b.sent).toContainText('ℹ️ Responda a um áudio com !transcribe (ou !t)');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it.each([
    [UNINTELLIGIBLE, /não consegui entender/],
    [SILENT, /vazio ou silencioso/],
  ])('áudio sem fala (%s) responde em texto corrido, sem o marcador', async (marker, pattern) => {
    const b = await start(scripted(marker));

    await b.receive({ text: '!t', voice: fixtures.voice() });

    expect(b.sent).toContainText(pattern);
    expect(b.sent).not.toContainText(/\[áudio/);
  });

  it('falha da IA: resposta curta e erro no log, sem vazar a causa', async () => {
    const err = new APICallError({
      message: 'chave inválida',
      url: 'x',
      requestBodyValues: {},
      statusCode: 401,
    });
    const b = await start(scripted(err));

    await b.receive({ text: '!t', voice: fixtures.voice() });

    expect(b.sent).toHaveReplied('⚠️ Não consegui transcrever esse áudio.');
    expect(b.sent).not.toContainText(/chave inválida/);
  });

  it('transcrição vazia também é falha', async () => {
    const b = await start(scripted('   '));

    await b.receive({ text: '!t', voice: fixtures.voice() });

    expect(b.sent).toHaveReplied('⚠️ Não consegui transcrever esse áudio.');
  });

  it('áudio acima de maxBytes nem vai ao modelo', async () => {
    const model = scripted('x');
    const b = await start(model, { maxBytes: 10 });

    await b.receive({ text: '!t', voice: fixtures.voice() });

    expect(b.sent).toHaveReplied('⚠️ Esse áudio é grande demais para transcrever.');
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe('modelo da transcrição', () => {
  it('usa a cadeia própria e deixa a principal intocada', async () => {
    const principal = scripted('da principal');
    const gemini = scripted('transcrito pelo gemini');
    const b = await start(principal, { models: [{ model: 'fake:g' }] }, { g: gemini });

    await b.receive({ text: '!t', voice: fixtures.voice() });

    expect(b.sent).toHaveReplied('🎙️ "transcrito pelo gemini"');
    expect(principal.doGenerateCalls).toHaveLength(0);
  });

  it('rejeita item fora do formato provider:modelo', async () => {
    await expect(
      createTestBot({
        plugins: [ai, transcribe],
        pluginConfig: { transcribe: { models: [{ model: 'gemini' }] } },
      }),
    ).rejects.toThrow(/provider:modelo/);
  });
});

describe('tool transcribe_audio', () => {
  it('devolve o texto só ao modelo: nada vai para o chat', async () => {
    const b = await start(scripted('texto do áudio'));

    await b.receive({ text: '!tool transcribe_audio', voice: fixtures.voice() });

    expect(toolResult(b)).toEqual({ ok: true, text: 'texto do áudio' });
    expect(
      b.sent.filter(({ content }) => content.type === 'text' && content.text.includes('🎙️')),
    ).toEqual([]);
  });

  it('pega o áudio da mensagem citada', async () => {
    const b = await start(scripted('citado'));

    await b.receive({ text: '!tool transcribe_audio', quoted: { voice: fixtures.voice() } });

    expect(toolResult(b)).toEqual({ ok: true, text: 'citado' });
  });

  it('sem áudio: no-audio', async () => {
    const b = await start(scripted('x'));

    await b.receive({ text: '!tool transcribe_audio', image: fixtures.image() });

    expect(toolResult(b)).toEqual({ ok: false, error: 'no-audio' });
  });

  it('cadeia indisponível: unavailable', async () => {
    bot = await createTestBot({ plugins: [ai, transcribe, aiToolsProbe] });

    await bot.receive({ text: '!tool transcribe_audio', voice: fixtures.voice() });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('áudio grande: too-large', async () => {
    const b = await start(scripted('x'), { maxBytes: 10 });

    await b.receive({ text: '!tool transcribe_audio', voice: fixtures.voice() });

    expect(toolResult(b)).toEqual({ ok: false, error: 'too-large' });
  });
});

describe('audioMediaType', () => {
  it.each([
    ['audio/ogg; codecs=opus', 'audio/ogg'],
    ['audio/mpeg', 'audio/mp3'],
    ['AUDIO/MP4', 'audio/mp4'],
    ['application/octet-stream', 'audio/ogg'],
  ])('%s → %s', (input, expected) => {
    expect(audioMediaType(input)).toBe(expected);
  });
});

describe('log e métricas', () => {
  const observed = (model: ReturnType<typeof scripted>, config: Record<string, unknown> = {}) =>
    observedBot([ai, fakeProvider({ a: model }), transcribe], {
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, transcribe: config },
    });

  it('transcrição vira transcribe.audio.done com o resultado, nunca o texto', async () => {
    const o = await observed(scripted('meu segredo'));
    bot = o.bot;

    await bot.receive({ text: '!t', voice: fixtures.voice() });

    expect(o.event('transcribe.audio.done')).toMatchObject({
      kind: 'audio',
      result: 'text',
      bytes: fixtures.voice().data.length,
    });
    expect(JSON.stringify(o.lines)).not.toContain('meu segredo');
    expect(await o.rows('luma_transcribe_total')).toMatchObject([
      { labels: { kind: 'audio', outcome: 'ok' }, value: 1 },
    ]);
  });

  it('áudio grande demais é recusa', async () => {
    const o = await observed(scripted('x'), { maxBytes: 1 });
    bot = o.bot;

    await bot.receive({ text: '!t', voice: fixtures.voice() });

    expect(o.event('transcribe.audio.refused')).toMatchObject({ reason: 'too-large' });
    expect(await o.rows('luma_transcribe_total')).toMatchObject([
      { labels: { kind: 'audio', outcome: 'refused' }, value: 1 },
    ]);
  });
});
