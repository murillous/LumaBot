import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, scripted } from '#plugins/ai-testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
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

    const text = formatTavily({ results });

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

  it('sem nada, diz que não achou', () => {
    expect(formatTavily({})).toBe('Nenhum resultado encontrado.');
  });
});
