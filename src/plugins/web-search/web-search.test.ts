import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, groundedAnswer, scripted } from '#plugins/ai/testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai/tools-probe.ts';
import { observedBot } from '#plugins/observe-probe.ts';
import { usage } from '#plugins/usage/usage.ts';
import { usageProbe } from '#plugins/usage/usage-testing.ts';
import { formatTavily, TavilyError } from './tavily.ts';
import { webSearch } from './web-search.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const tavilyOk = {
  answer: 'O dólar fechou a R$ 5,10.',
  results: [{ title: 'Dólar hoje', content: 'Cotação em alta.' }],
};

/** Roda `!tool search_web` como a IA faria e devolve o resultado em JSON. */
async function search(b: TestBot, query = 'dólar hoje') {
  await b.receive({ text: `!tool search_web ${JSON.stringify({ query })}` });
  return toolResult(b);
}

describe('Tavily', () => {
  it('busca com a chave e devolve o resumo e as fontes ao modelo', async () => {
    const fetchFn = vi.fn(async () => json(tavilyOk));
    bot = await createTestBot({
      plugins: [webSearch({ fetch: fetchFn as never }), aiToolsProbe],
      pluginConfig: { 'web-search': { tavily: { apiKey: 'tvly-secreta', maxResults: 3 } } },
    });

    const result = await search(bot);

    expect(result).toEqual({
      ok: true,
      results: 'Resumo: O dólar fechou a R$ 5,10.\n\n[1] Dólar hoje\nCotação em alta.',
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(String(init.body))).toMatchObject({
      api_key: 'tvly-secreta',
      query: 'dólar hoje',
      max_results: 3,
      include_answer: true,
    });
  });

  it('sem chave nem ai, a busca fica indisponível para o modelo', async () => {
    const fetchFn = vi.fn();
    bot = await createTestBot({
      plugins: [webSearch({ fetch: fetchFn as never }), aiToolsProbe],
    });

    expect(await search(bot)).toEqual({ ok: false, error: 'unavailable' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('erro de rede sem fallback vira falha para o modelo, não exceção', async () => {
    const fetchFn = vi.fn(async () => json({ detail: 'boom' }, 500));
    bot = await createTestBot({
      plugins: [webSearch({ fetch: fetchFn as never }), aiToolsProbe],
      pluginConfig: { 'web-search': { tavily: { apiKey: 'tvly-secreta' } } },
    });

    expect(await search(bot)).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('Google Grounding como fallback', () => {
  const grounding = (fetchFn: typeof fetch, extra: Record<string, unknown> = {}) => {
    const model = scripted('Segundo a busca, o dólar fechou a R$ 5,10.');
    return {
      model,
      start: () =>
        createTestBot({
          plugins: [
            ai,
            fakeProvider({ a: model }, { nativeSearch: true }),
            webSearch({ fetch: fetchFn }),
            aiToolsProbe,
          ],
          pluginConfig: {
            ai: { models: [{ model: 'fake:a' }] },
            'web-search': extra,
          },
        }),
    };
  };

  it('as fontes da busca nativa vão ao modelo com a URL, sem repetir', async () => {
    const model = scripted(
      groundedAnswer('O meme é de 2014.', [
        { url: 'https://knowyourmeme.com/gato', title: 'Gato chorando' },
        { url: 'https://knowyourmeme.com/gato', title: 'Gato chorando' },
        { url: 'https://youtu.be/abc' },
      ]),
    );
    bot = await createTestBot({
      plugins: [
        ai,
        fakeProvider({ a: model }, { nativeSearch: true }),
        webSearch({ fetch: vi.fn() as never }),
        aiToolsProbe,
      ],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
    });

    expect(await search(bot)).toEqual({
      ok: true,
      results:
        'O meme é de 2014.\n\nFontes:\n[1] Gato chorando\nhttps://knowyourmeme.com/gato\n[2] https://youtu.be/abc',
    });
  });

  it('sem chave do Tavily, busca pelo provider com busca nativa', async () => {
    const g = grounding(vi.fn() as never);
    bot = await g.start();

    const result = await search(bot);

    expect(result).toEqual({
      ok: true,
      results: 'Segundo a busca, o dólar fechou a R$ 5,10.',
    });
    expect(g.model.doGenerateCalls[0]?.tools?.map((t) => t.name)).toEqual(['fake_search']);
  });

  it('cota do Tavily esgotada: usa o provider e deixa o Tavily de lado pelo cooldown', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-18T12:00:00Z') });
    try {
      const fetchFn = vi.fn(async () => json({ detail: 'plan limit' }, 432));
      const g = grounding(fetchFn as never, { tavily: { apiKey: 'tvly-secreta' } });
      bot = await g.start();

      await search(bot);
      await search(bot);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60 * 60_000 + 1);
      await search(bot);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falha comum do Tavily também cai no provider, sem esperar cooldown', async () => {
    const fetchFn = vi.fn(async () => json({}, 500));
    const g = grounding(fetchFn as never, { tavily: { apiKey: 'tvly-secreta' } });
    bot = await g.start();

    await search(bot);
    await search(bot);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('Tavily sem resposta no prazo cai no provider, sem cooldown de cota', async () => {
    // Prazo curto no lugar dos 10 s; o signal do listener (aqui ausente) nunca é o que corta.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    try {
      const fetchFn = vi.fn((_url: unknown, init?: RequestInit) =>
        // O signal já nasce abortado (prazo simulado); fetch de verdade rejeitaria na hora.
        init?.signal?.aborted
          ? Promise.reject(init.signal.reason)
          : new Promise<Response>(() => undefined),
      );
      const g = grounding(fetchFn as never, { tavily: { apiKey: 'tvly-secreta' } });
      bot = await g.start();

      expect(await search(bot)).toMatchObject({ ok: true });
      await search(bot);

      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('400 com "limit" no corpo não liga o cooldown', async () => {
    const fetchFn = vi.fn(async () => json({ detail: 'query exceeds the limit' }, 400));
    const g = grounding(fetchFn as never, { tavily: { apiKey: 'tvly-secreta' } });
    bot = await g.start();

    await search(bot);
    await search(bot);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([429, 432, 433])('status %i liga o cooldown', async (status) => {
    const fetchFn = vi.fn(async () => json({ detail: 'x' }, status));
    const g = grounding(fetchFn as never, { tavily: { apiKey: 'tvly-secreta' } });
    bot = await g.start();

    await search(bot);
    await search(bot);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('usa a cadeia própria da busca quando configurada', async () => {
    const principal = scripted('da principal');
    const busca = scripted('da busca');
    bot = await createTestBot({
      plugins: [
        ai,
        fakeProvider({ p: principal, b: busca }, { nativeSearch: true }),
        webSearch({ fetch: vi.fn() as never }),
        aiToolsProbe,
      ],
      pluginConfig: {
        ai: { models: [{ model: 'fake:p' }] },
        'web-search': { models: [{ model: 'fake:b' }] },
      },
    });

    expect(await search(bot)).toMatchObject({ results: 'da busca' });
    expect(principal.doGenerateCalls).toHaveLength(0);
  });
});

describe('formatTavily', () => {
  it('limita a 4 fontes de 350 caracteres', () => {
    const results = Array.from({ length: 6 }, (_, i) => ({
      title: `T${i}`,
      content: 'x'.repeat(500),
    }));

    const text = formatTavily({ results }, 4);

    expect(text.match(/\[\d\]/g)).toHaveLength(4);
    expect(text).not.toContain('x'.repeat(351));
  });

  it('mostra até maxResults fontes', () => {
    const results = Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, content: 'c' }));

    expect(formatTavily({ results }, 7).match(/\[\d\]/g)).toHaveLength(7);
  });

  it('só texto de cota em 401/402/403 conta como cota', () => {
    expect(new TavilyError(400, 'limit').quota).toBe(false);
    expect(new TavilyError(432, '').quota).toBe(true);
    expect(new TavilyError(403, 'usage limit exceeded').quota).toBe(true);
  });

  it('leva a URL de cada fonte, para o modelo não inventar link', () => {
    const results = [
      { title: 'Gato chorando', url: 'https://youtu.be/abc?t=3', content: 'meme' },
      { title: 'Sem link', content: 'só texto' },
    ];

    expect(formatTavily({ results }, 5)).toBe(
      '[1] Gato chorando\nhttps://youtu.be/abc?t=3\nmeme\n\n[2] Sem link\nsó texto',
    );
  });

  it('sem nada, diz que não achou', () => {
    expect(formatTavily({}, 4)).toBe('Nenhum resultado encontrado.');
  });
});

describe('config', () => {
  it('recusa model sem provider: pelo schema compartilhado da cadeia', async () => {
    await expect(
      createTestBot({
        plugins: [webSearch(), aiToolsProbe],
        pluginConfig: { 'web-search': { models: [{ model: 'gemini-flash' }] } },
      }),
    ).rejects.toThrow(/provider:modelo/);
  });
});

describe('log e métricas', () => {
  it('cada backend tentado conta: Tavily sem cota recusa e a nativa responde', async () => {
    const fetchFn = vi.fn(async () => json({ detail: 'plan limit' }, 432));
    const o = await observedBot(
      [
        ai,
        fakeProvider({ a: scripted('ok') }, { nativeSearch: true }),
        webSearch({ fetch: fetchFn as never }),
        aiToolsProbe,
      ],
      {
        pluginConfig: {
          ai: { models: [{ model: 'fake:a' }] },
          'web-search': { tavily: { apiKey: 'tvly-secreta' } },
        },
      },
    );
    bot = o.bot;

    await search(bot, 'termo secreto');

    expect(o.event('web-search.search.refused')).toMatchObject({ kind: 'tavily', reason: 'quota' });
    expect(o.event('web-search.search.done')).toMatchObject({ kind: 'native' });
    expect(JSON.stringify(o.lines)).not.toMatch(/termo secreto|tvly-secreta/);
    const rows = await o.rows('luma_web_search_total');
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { kind: 'tavily', outcome: 'refused' }, value: 1 }),
        expect.objectContaining({ labels: { kind: 'native', outcome: 'ok' }, value: 1 }),
      ]),
    );
  });

  it('erro de rede no Tavily vira web-search.search.failed', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const o = await observedBot([webSearch({ fetch: fetchFn as never }), aiToolsProbe], {
      pluginConfig: { 'web-search': { tavily: { apiKey: 'tvly-secreta' } } },
    });
    bot = o.bot;

    await search(bot);

    expect(o.event('web-search.search.failed')).toMatchObject({
      kind: 'tavily',
      err: expect.any(Object),
    });
    expect(await o.rows('luma_web_search_total')).toMatchObject([
      { labels: { kind: 'tavily', outcome: 'error' }, value: 1 },
    ]);
  });
});

it('a busca conta no usage de quem pediu à IA', async () => {
  const probe = usageProbe();
  bot = await createTestBot({
    plugins: [
      webSearch({ fetch: vi.fn(async () => json(tavilyOk)) as never }),
      aiToolsProbe,
      usage,
      probe.plugin,
    ],
    pluginConfig: { 'web-search': { tavily: { apiKey: 'tvly-secreta' } } },
  });

  await search(bot);

  expect(probe.entries).toEqual([
    expect.objectContaining({ action: 'web_search', kind: 'tavily', outcome: 'ok' }),
  ]);
});

describe('search_images', () => {
  const images = {
    images: [
      { url: 'https://i.imgur.com/gato.jpg', description: 'gato chorando com legenda' },
      'https://i.imgur.com/sem-descricao.png',
    ],
  };

  it('busca imagens pela descrição e devolve as URLs ao modelo', async () => {
    const fetchFn = vi.fn(async () => json(images));
    bot = await createTestBot({
      plugins: [webSearch({ fetch: fetchFn as never }), aiToolsProbe],
      pluginConfig: { 'web-search': { tavily: { apiKey: 'tvly-secreta' } } },
    });

    await bot.receive({ text: '!tool search_images {"query":"meme gato chorando"}' });

    expect(toolResult(bot)).toEqual({
      ok: true,
      images: [
        { url: 'https://i.imgur.com/gato.jpg', description: 'gato chorando com legenda' },
        { url: 'https://i.imgur.com/sem-descricao.png' },
      ],
    });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      query: 'meme gato chorando',
      include_images: true,
      include_image_descriptions: true,
    });
  });

  it('sem chave do Tavily, a busca de imagens fica indisponível', async () => {
    bot = await createTestBot({
      plugins: [webSearch({ fetch: vi.fn() as never }), aiToolsProbe],
    });

    await bot.receive({ text: '!tool search_images {"query":"meme"}' });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('nenhuma imagem achada vira not-found', async () => {
    bot = await createTestBot({
      plugins: [
        webSearch({ fetch: vi.fn(async () => json({ images: [] })) as never }),
        aiToolsProbe,
      ],
      pluginConfig: { 'web-search': { tavily: { apiKey: 'tvly-secreta' } } },
    });

    await bot.receive({ text: '!tool search_images {"query":"meme"}' });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('send_image', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function start() {
    bot = await createTestBot({ plugins: [webSearch({ fetch: vi.fn() as never }), aiToolsProbe] });
    return bot;
  }

  it('baixa a imagem do link e envia no chat, com a legenda', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(PNG)),
    );
    const b = await start();

    await b.receive({
      text: '!tool send_image {"url":"https://93.184.216.34/gato.png","caption":"kkkk"}',
    });

    expect(toolResult(b)).toEqual({ ok: true });
    const [sent] = b.sentMedia('image');
    expect(sent?.content).toMatchObject({ caption: 'kkkk', mimetype: 'image/png' });
  });

  it('link que não é imagem vira not-image, sem enviar nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>oi</html>')),
    );
    const b = await start();

    await b.receive({ text: '!tool send_image {"url":"https://93.184.216.34/pagina"}' });

    expect(toolResult(b)).toEqual({ ok: false, error: 'not-image' });
    expect(b.sentMedia('image')).toHaveLength(0);
  });

  it('endereço interno não é baixado: url-failed', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const b = await start();

    await b.receive({ text: '!tool send_image {"url":"http://127.0.0.1:8080/admin"}' });

    expect(toolResult(b)).toEqual({ ok: false, error: 'url-failed' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
