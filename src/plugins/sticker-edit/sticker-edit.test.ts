import { MediaExpiredError } from '@usebridger/core';
import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { aiContext } from '#plugins/ai-context/ai-context.ts';
import { fakeProvider, type PaintedModel, painted, scripted } from '#plugins/ai-testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { luma } from '#plugins/luma/luma.ts';
import { sticker } from '#plugins/sticker/sticker.ts';
import { usage } from '#plugins/usage/usage.ts';
import { usageProbe } from '#plugins/usage/usage-testing.ts';
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

it('a edição conta no usage de quem pediu', async () => {
  const probe = usageProbe();
  bot = await createTestBot({
    plugins: [
      ai,
      fakeProvider({ a: scripted('ok') }, { images: { x: painted(edited) } }),
      sticker,
      stickerEdit,
      usage,
      probe.plugin,
    ],
    pluginConfig: {
      ai: { models: [{ model: 'fake:a' }] },
      'sticker-edit': { models: ['fake:x'] },
    },
  });

  await bot.receive({ text: '!editar coloca um chapéu', quoted: { sticker: fixtures.sticker() } });

  expect(probe.entries).toEqual([
    expect.objectContaining({ action: 'sticker_edit', kind: 'sticker', outcome: 'ok' }),
  ]);
});

describe('tool edit_sticker por ID da conversa', () => {
  const group = { id: 'grupo@fake', isGroup: true };
  const colored = async (background: string) => ({
    data: await sharp({ create: { width: 64, height: 64, channels: 4, background } })
      .webp()
      .toBuffer(),
    mimetype: 'image/webp',
  });
  /** Cor do pixel do meio da imagem que o modelo recebeu. */
  const centerColor = async (file: unknown) => {
    const data = (file as { data: Uint8Array }).data;
    const { data: px, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    const at =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    return { r: px[at] ?? 0, g: px[at + 1] ?? 0, b: px[at + 2] ?? 0 };
  };

  async function startWithLuma(model: PaintedModel, withLuma = true) {
    bot = await createTestBot({
      plugins: [
        ai,
        fakeProvider({ a: scripted('ok') }, { images: { x: model } }),
        sticker,
        stickerEdit,
        ...(withLuma ? [aiContext, luma] : []),
        aiToolsProbe,
      ],
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        'sticker-edit': { models: ['fake:x'] },
        luma: { thinkingDelayMs: { min: 0, max: 0 } },
      },
    });
    return bot;
  }

  it('junta mídias anteriores: target é a base, references vão depois, na ordem', async () => {
    const model = painted(edited);
    const b = await startWithLuma(model);
    await b.receive({ sticker: await colored('#00ff00'), chat: group, sender: { name: 'Ana' } });
    await b.receive({ sticker: await colored('#0000ff'), chat: group, sender: { name: 'Bia' } });

    await b.receive({
      text: '!tool edit_sticker {"request":"put the head from the reference image on the sticker","target":"#m2","references":["m1"]}',
      chat: group,
    });

    expect(toolResult(b)).toEqual({ ok: true, model: 'fake:x' });
    const files = model.calls[0]?.files ?? [];
    expect(files).toHaveLength(2);
    const base = await centerColor(files[0]);
    const reference = await centerColor(files[1]);
    expect(base.b).toBeGreaterThan(200);
    expect(base.g).toBeLessThan(60);
    expect(reference.g).toBeGreaterThan(200);
    expect(reference.b).toBeLessThan(60);
    expect(model.calls[0]?.prompt).toMatch(/first image is the sticker/);
  });

  it('alvo por ID leva a foto da própria mensagem como referência', async () => {
    const model = painted(edited);
    const b = await startWithLuma(model);
    await b.receive({ sticker: fixtures.sticker(), chat: group });

    await b.receive({
      text: '!tool edit_sticker {"request":"x","target":"m1"}',
      image: fixtures.image(),
      chat: group,
    });

    expect(toolResult(b)).toEqual({ ok: true, model: 'fake:x' });
    expect(model.calls[0]?.files).toHaveLength(2);
  });

  it('recusa ID desconhecido, alvo que não é figurinha e fala sem mídia, dizendo qual', async () => {
    const model = painted(edited);
    const b = await startWithLuma(model);
    await b.receive({ image: fixtures.image(), chat: group });
    await b.receive({ text: 'só texto', chat: group });

    await b.receive({ text: '!tool edit_sticker {"request":"x","target":"m9"}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'unknown', detail: 'm9' });

    await b.receive({ text: '!tool edit_sticker {"request":"x","target":"m1"}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'not-sticker', detail: 'm1' });

    await b.receive({
      text: '!tool edit_sticker {"request":"x","target":"m1","references":["m2"]}',
      chat: group,
    });
    expect(toolResult(b)).toEqual({ ok: false, error: 'not-sticker', detail: 'm1' });

    await b.receive({
      text: '!tool edit_sticker {"request":"x","references":["m2"]}',
      sticker: fixtures.sticker(),
      chat: group,
    });
    expect(toolResult(b)).toEqual({ ok: false, error: 'no-media', detail: 'm2' });
    expect(model.calls).toHaveLength(0);
  });

  it('mídia que saiu da plataforma volta como expired', async () => {
    const model = painted(edited);
    const b = await startWithLuma(model);
    await b.receive({ sticker: fixtures.sticker(), chat: group });
    vi.spyOn(b.transport, 'mediaFromRef').mockReturnValue({
      download: () => Promise.reject(new MediaExpiredError('sumiu')),
      stream: () => Promise.reject(new MediaExpiredError('sumiu')),
    });

    await b.receive({ text: '!tool edit_sticker {"request":"x","target":"m1"}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'expired' });
    expect(model.calls).toHaveLength(0);
  });

  it('sem a luma, que guarda a conversa, ID não tem como valer', async () => {
    const b = await startWithLuma(painted(edited), false);

    await b.receive({ text: '!tool edit_sticker {"request":"x","target":"m1"}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'no-history' });
  });
});
