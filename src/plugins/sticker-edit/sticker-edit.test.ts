import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, type PaintedModel, painted, scripted } from '#plugins/ai-testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { sticker } from '#plugins/sticker/sticker.ts';
import { stickerEdit } from './sticker-edit.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

/** PNG de verdade: a figurinha editada passa pelo `sharp` do `sticker`. */
let edited: Uint8Array;
beforeAll(async () => {
  edited = await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#ff0000' },
  })
    .png()
    .toBuffer();
});

const apiError = (statusCode: number) =>
  new APICallError({ message: `http ${statusCode}`, url: 'x', requestBodyValues: {}, statusCode });

async function start(images: Record<string, PaintedModel>, config: Record<string, unknown> = {}) {
  bot = await createTestBot({
    plugins: [
      ai,
      fakeProvider({ a: scripted('ok') }, { images }),
      sticker,
      stickerEdit,
      aiToolsProbe,
    ],
    pluginConfig: {
      ai: { models: [{ model: 'fake:a' }] },
      'sticker-edit': { models: Object.keys(images).map((id) => `fake:${id}`), ...config },
    },
  });
  return bot;
}

describe('!editar', () => {
  it('edita a figurinha citada e responde com a figurinha editada', async () => {
    const model = painted(edited);
    const b = await start({ x: model });

    await b.receive({ text: '!editar coloca um chapéu', quoted: { sticker: fixtures.sticker() } });

    expect(b.sent).toContainSticker();
    expect(model.calls[0]?.prompt).toContain('coloca um chapéu');
    // A figurinha (WebP) vai ao modelo como PNG.
    const input = model.calls[0]?.files?.[0];
    expect(input?.type === 'file' && input.mediaType).toBe('image/png');
  });

  it('cai para o próximo modelo quando um falha, e o 429 vai para o fim da cadeia', async () => {
    const quota = painted(apiError(429));
    const forbidden = painted(apiError(403));
    const works = painted(edited);
    const b = await start({ quota, forbidden, works });

    await b.receive({ text: '!editar deixa azul', sticker: fixtures.sticker() });
    await b.receive({ text: '!edit deixa verde', sticker: fixtures.sticker() });

    expect(b.sentMedia('sticker')).toHaveLength(2);
    expect(forbidden.calls).toHaveLength(2);
    // No segundo pedido, o modelo em cooldown foi o último e nem chegou a ser chamado.
    expect(quota.calls).toHaveLength(1);
  });

  it('pula item sem provider ou sem modelo de imagem', async () => {
    const b = await start(
      { x: painted(edited) },
      { models: ['cloudflare:flux-2-klein-4b', 'fake:x'] },
    );

    await b.receive({ text: '!editar tira o fundo', sticker: fixtures.sticker() });

    expect(b.sent).toContainSticker();
  });

  it('nenhum modelo editou: resposta curta, sem vazar a causa', async () => {
    const b = await start({ x: painted(apiError(429)) });

    await b.receive({ text: '!editar tira o fundo', sticker: fixtures.sticker() });

    expect(b.sent).toContainText(/Não consegui editar essa figurinha agora/);
    expect(b.sent).not.toContainText(/http 429/);
  });

  it('sem pedido, sem figurinha ou com foto, explica como usar e não chama o modelo', async () => {
    const model = painted(edited);
    const b = await start({ x: model });

    await b.receive({ text: '!editar', sticker: fixtures.sticker() });
    await b.receive({ text: '!editar coloca um chapéu' });
    await b.receive({ text: '!editar coloca um chapéu', image: fixtures.image() });

    expect(b.sent).toContainText(/Responda a uma figurinha com !editar/);
    expect(model.calls).toHaveLength(0);
  });

  it('figurinha acima de maxBytes nem vai ao modelo', async () => {
    const model = painted(edited);
    const b = await start({ x: model }, { maxBytes: 10 });

    await b.receive({ text: '!editar coloca um chapéu', sticker: fixtures.sticker() });

    expect(b.sent).toContainText('⚠️ Essa figurinha é grande demais para editar.');
    expect(model.calls).toHaveLength(0);
  });
});

describe('filtro de conteúdo', () => {
  const flagged = () =>
    new APICallError({
      message: 'Cloudflare respondeu 400: 3030 flagged',
      url: 'x',
      requestBodyValues: {},
      statusCode: 400,
      data: { flagged: true },
    });

  it('o comando explica a recusa em vez de falar em erro', async () => {
    const b = await start({ x: painted(flagged()) });

    await b.receive({ text: '!editar coloca um chapéu', sticker: fixtures.sticker() });

    expect(b.sent).toContainText(/recusou editar essa figurinha/);
    expect(b.sent).not.toContainText(/Tenta de novo mais tarde/);
  });

  it('recusa num modelo e cota esgotada em outro: vale a recusa', async () => {
    const b = await start({ x: painted(flagged()), y: painted(apiError(429)) });

    await b.receive({ text: '!tool edit_sticker {"request":"x"}', sticker: fixtures.sticker() });

    expect(toolResult(b)).toEqual({ ok: false, error: 'flagged' });
  });

  it('recusa num modelo, outro edita: sai a figurinha', async () => {
    const b = await start({ x: painted(flagged()), y: painted(edited) });

    await b.receive({ text: '!editar coloca um chapéu', sticker: fixtures.sticker() });

    expect(b.sent).toContainSticker();
  });
});

describe('imagem de referência', () => {
  it('responder à figurinha com uma foto manda a foto como segunda imagem', async () => {
    const model = painted(edited);
    const b = await start({ x: model });

    await b.receive({
      text: '!editar coloca o rosto dessa pessoa',
      image: fixtures.image(),
      quoted: { sticker: fixtures.sticker() },
    });

    expect(b.sent).toContainSticker();
    expect(model.calls[0]?.files).toHaveLength(2);
    expect(model.calls[0]?.prompt).toMatch(/first image is the sticker/);
    expect(model.calls[0]?.prompt).toContain('coloca o rosto dessa pessoa');
  });

  it('sem referência, o prompt não fala de outra imagem', async () => {
    const model = painted(edited);
    const b = await start({ x: model });

    await b.receive({ text: '!editar deixa azul', quoted: { sticker: fixtures.sticker() } });

    expect(model.calls[0]?.files).toHaveLength(1);
    expect(model.calls[0]?.prompt).not.toMatch(/reference/);
  });

  it('a tool também leva a foto da mensagem como referência', async () => {
    const model = painted(edited);
    const b = await start({ x: model });

    await b.receive({
      text: '!tool edit_sticker {"request":"put the face of the reference image on the sticker"}',
      image: fixtures.image(),
      quoted: { sticker: fixtures.sticker() },
    });

    expect(toolResult(b)).toEqual({ ok: true, model: 'fake:x' });
    expect(model.calls[0]?.files).toHaveLength(2);
  });

  it('referência de visualização única é recusada', async () => {
    const model = painted(edited);
    const b = await start({ x: model });

    await b.receive({
      text: '!editar coloca o rosto',
      image: fixtures.image(),
      isViewOnce: true,
      quoted: { sticker: fixtures.sticker() },
    });

    expect(b.sent).toContainText(/visualização única/);
    expect(model.calls).toHaveLength(0);
  });
});

describe('tool edit_sticker', () => {
  it('edita, envia a figurinha e conta ao modelo quem editou', async () => {
    const model = painted(edited);
    const b = await start({ x: model });

    await b.receive({
      text: '!tool edit_sticker {"request":"add a red party hat"}',
      quoted: { sticker: fixtures.sticker() },
    });

    expect(toolResult(b)).toEqual({ ok: true, model: 'fake:x' });
    expect(b.sent).toContainSticker();
    expect(model.calls[0]?.prompt).toContain('add a red party hat');
  });

  it('sem figurinha devolve no-sticker; sem modelo, unavailable', async () => {
    const b = await start({ x: painted(apiError(503)) });

    await b.receive({ text: '!tool edit_sticker {"request":"x"}', image: fixtures.image() });
    expect(toolResult(b)).toEqual({ ok: false, error: 'no-sticker' });

    await b.receive({ text: '!tool edit_sticker {"request":"x"}', sticker: fixtures.sticker() });
    expect(toolResult(b)).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('config', () => {
  it('rejeita item fora do formato provider:modelo', async () => {
    await expect(
      createTestBot({
        plugins: [ai, sticker, stickerEdit],
        pluginConfig: { 'sticker-edit': { models: ['flux'] } },
      }),
    ).rejects.toThrow(/provider:modelo/);
  });
});
