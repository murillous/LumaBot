import { definePlugin } from '@usebridger/core';
import { type MetricsService, metrics } from '@usebridger/plugin-metrics';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AiService, ai } from '#plugins/ai/ai.ts';
import { fakeProvider, scripted, textAnswer } from '#plugins/ai-testing.ts';
import { usage } from '#plugins/usage/usage.ts';
import { usageProbe } from '#plugins/usage/usage-testing.ts';
import { type AiMetricsService, aiMetrics } from './ai-metrics.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

interface Handles {
  ai: AiService;
  summary: AiMetricsService['summary'];
}

/** Sobe o bot com o `metrics` real e devolve o `ai` e o `aiMetrics` como um consumidor os veria. */
async function start(
  models: Record<string, MockLanguageModelV4>,
  chain: string[],
  metricsConfig: Record<string, unknown> = {},
): Promise<Handles> {
  let handles: Handles | undefined;
  const consumer = definePlugin({
    name: 'consumidor',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0', 'ai-metrics': '^0.1.0' },
    setup: (ctx) => {
      handles = {
        ai: ctx.services.get('ai'),
        summary: (options) => ctx.services.get('aiMetrics').summary(options),
      };
    },
  });
  bot = await createTestBot({
    plugins: [metrics, ai, fakeProvider(models), aiMetrics, consumer],
    pluginConfig: {
      ai: { models: chain.map((model) => ({ model })) },
      'ai-metrics': metricsConfig,
    },
  });
  if (!handles) throw new Error('serviços não capturados');
  return handles;
}

const hi = (purpose = 'luma') => ({
  purpose,
  messages: [{ role: 'user' as const, content: 'oi' }],
});

const apiError = (statusCode: number) =>
  new APICallError({ message: `http ${statusCode}`, url: 'x', requestBodyValues: {}, statusCode });

describe('observer do ai', () => {
  it('conta a resposta, os tokens, a latência e o finishReason de cada modelo', async () => {
    const h = await start({ a: scripted('oi') }, ['fake:a']);

    await h.ai.generate(hi());
    await h.ai.generate(hi());
    const { total, models } = await h.summary();

    expect(total).toMatchObject({
      attempts: 2,
      responses: 2,
      firstTry: 2,
      successRate: 1,
      tokens: { input: 6, output: 4 },
      avgInputTokens: 3,
      avgOutputTokens: 2,
      finishReasons: { stop: 2 },
    });
    expect(total.latencyMs.avg).not.toBeNull();
    expect(models.map((m) => m.model)).toEqual(['fake:a']);
  });

  it('registra o fallback: quem falhou, com o status, e quem salvou', async () => {
    const h = await start({ a: scripted(apiError(429)), b: scripted('de b') }, [
      'fake:a',
      'fake:b',
    ]);

    await h.ai.generate(hi());
    const { models } = await h.summary();

    const a = models.find((m) => m.model === 'fake:a');
    const b = models.find((m) => m.model === 'fake:b');
    expect(a).toMatchObject({
      responses: 0,
      outcomes: { transient: 1 },
      statusCodes: { '429': 1 },
    });
    expect(b).toMatchObject({ responses: 1, savedByFallback: 1, firstTry: 0 });
  });

  it('item sem provider fica de fora da taxa de sucesso', async () => {
    const h = await start({ b: scripted('ok') }, ['sumido:x', 'fake:b']);

    await h.ai.generate(hi());
    const { total } = await h.summary();

    expect(total.outcomes).toMatchObject({ unregistered: 1, ok: 1 });
    expect(total.successRate).toBe(1);
  });

  it('separa o consumo por finalidade e filtra por modelo ou finalidade', async () => {
    const h = await start({ a: scripted('x'), b: scripted('y') }, ['fake:a']);

    await h.ai.generate(hi('luma'));
    await h.ai.generate(hi('resumo'));
    await h.ai.generate({ ...hi('transcribe'), models: [{ model: 'fake:b' }] });

    const all = await h.summary();
    expect(all.purposes.map((p) => [p.purpose, p.responses])).toEqual([
      ['luma', 1],
      ['resumo', 1],
      ['transcribe', 1],
    ]);
    expect((await h.summary({ purpose: 'resumo' })).total.responses).toBe(1);
    expect((await h.summary({ model: 'fake:b' })).total.responses).toBe(1);
    expect((await h.summary({ model: 'fake:b', purpose: 'luma' })).total.responses).toBe(0);
  });

  it('a tentativa de erro e a abortada também contam', async () => {
    const h = await start({ a: scripted(apiError(400)) }, ['fake:a']);

    await expect(h.ai.generate(hi())).rejects.toThrow();
    const { total } = await h.summary();

    expect(total).toMatchObject({
      attempts: 1,
      responses: 0,
      outcomes: { error: 1 },
      successRate: 0,
    });
  });

  it('tokens de cache e de reasoning entram à parte', async () => {
    const withCache = new MockLanguageModelV4({
      doGenerate: async () => ({
        ...textAnswer('ok'),
        usage: {
          inputTokens: { total: 10, noCache: 4, cacheRead: 6, cacheWrite: undefined },
          outputTokens: { total: 8, text: 5, reasoning: 3 },
        },
      }),
    });
    const h = await start({ a: withCache }, ['fake:a']);

    await h.ai.generate(hi());
    const { total } = await h.summary();

    expect(total.tokens).toEqual({ input: 10, output: 8, cacheRead: 6, reasoning: 3 });
    expect(total.cacheHitRate).toBeCloseTo(0.6);
  });

  it('a escrita no cache vira o tipo cache_write, para ver se o prefixo é reaproveitado', async () => {
    let metricsService: MetricsService | undefined;
    let aiService: AiService | undefined;
    const grab = definePlugin({
      name: 'grab',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { ai: '*', metrics: '*', 'ai-metrics': '*' },
      setup: (ctx) => {
        aiService = ctx.services.get('ai');
        metricsService = ctx.services.get('metrics');
      },
    });
    const writes = new MockLanguageModelV4({
      doGenerate: async () => ({
        ...textAnswer('ok'),
        usage: {
          inputTokens: { total: 10, noCache: 2, cacheRead: undefined, cacheWrite: 8 },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
      }),
    });
    bot = await createTestBot({
      plugins: [metrics, ai, fakeProvider({ a: writes }), aiMetrics, grab],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
    });

    await aiService?.generate(hi());

    const today = new Date().toISOString().slice(0, 10);
    const rows =
      (await metricsService?.query({
        name: 'ai_tokens_total',
        from: today,
        to: today,
        granularity: 'day',
        where: { kind: 'cache_write' },
      })) ?? [];
    expect(rows.map((r) => (r.type === 'counter' ? r.value : null))).toEqual([8]);
  });
});

describe('custo', () => {
  const prices = {
    prices: { 'fake:a': { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 } },
  };

  it('usa a tabela da config na consulta: 3 de entrada e 2 de saída a US$ 1 e 2 por token', async () => {
    const h = await start({ a: scripted('oi') }, ['fake:a'], prices);

    await h.ai.generate(hi());

    expect((await h.summary()).total.costUsd).toBeCloseTo(3 * 1 + 2 * 2);
  });

  it('modelo sem preço: sem custo, não zero', async () => {
    const h = await start({ a: scripted('oi'), b: scripted('oi') }, ['fake:a', 'fake:b'], prices);

    await h.ai.generate({ ...hi(), models: [{ model: 'fake:b' }] });
    const { total, models } = await h.summary();

    expect(total.costUsd).toBeNull();
    expect(total.unpricedModels).toEqual(['fake:b']);
    expect(models[0]?.costUsd).toBeNull();
  });

  it('custo por dia', async () => {
    const h = await start({ a: scripted('oi') }, ['fake:a'], prices);

    await h.ai.generate(hi());
    const { days } = await h.summary();

    expect(days).toHaveLength(1);
    expect(days[0]?.costUsd).toBeCloseTo(7);
  });
});

describe('privacidade', () => {
  it('as métricas guardam só modelo, finalidade e desfecho: nunca texto nem id', async () => {
    let metricsService: MetricsService | undefined;
    let aiService: AiService | undefined;
    const grab = definePlugin({
      name: 'grab',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { ai: '*', metrics: '*', 'ai-metrics': '*' },
      setup: (ctx) => {
        aiService = ctx.services.get('ai');
        metricsService = ctx.services.get('metrics');
      },
    });
    bot = await createTestBot({
      plugins: [
        metrics,
        ai,
        fakeProvider({ a: scripted('resposta secreta sobre a Ana') }),
        aiMetrics,
        grab,
      ],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
    });

    await aiService?.generate({
      purpose: 'luma',
      messages: [{ role: 'user', content: 'meu segredo, Ana 5511999999999' }],
    });

    const today = new Date().toISOString().slice(0, 10);
    const names = ((await metricsService?.catalog()) ?? [])
      .filter((d) => d.owner === 'ai-metrics')
      .map((d) => d.name);
    const rows = (
      await Promise.all(
        names.map((name) =>
          metricsService?.query({ name, from: today, to: today, granularity: 'day' }),
        ),
      )
    ).flat();
    expect(rows.length).toBeGreaterThan(0);
    const labelKeys = new Set(rows.flatMap((r) => Object.keys(r?.labels ?? {})));
    expect([...labelKeys].sort()).toEqual(
      ['kind', 'model', 'outcome', 'position', 'provider', 'purpose', 'reason'].sort(),
    );
    expect(JSON.stringify(rows)).not.toMatch(/segredo|Ana|5511999999999/);
  });
});

describe('uso por pessoa', () => {
  const actor = { id: '5511999@s.whatsapp.net', chatId: 'g@g.us' };
  // US$ 1 por token: as 3 de entrada e as 2 de saída do modelo falso custam 5.
  const perToken = { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 };

  /** Bot com o `usage` e uma sonda das linhas gravadas nele. */
  async function withUsage(
    models: Record<string, MockLanguageModelV4>,
    chain: string[],
    prices: Record<string, typeof perToken>,
  ) {
    const probe = usageProbe();
    let service: AiService | undefined;
    const consumer = definePlugin({
      name: 'consumidor',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { ai: '^0.1.0' },
      setup: (ctx) => {
        service = ctx.services.get('ai');
      },
    });
    bot = await createTestBot({
      plugins: [metrics, ai, fakeProvider(models), aiMetrics, usage, probe.plugin, consumer],
      pluginConfig: {
        ai: { models: chain.map((model) => ({ model })) },
        'ai-metrics': { prices },
      },
    });
    if (!service) throw new Error('serviço não capturado');
    return { ai: service, entries: probe.entries };
  }

  it('com fallback, a resposta é uma linha só, com o custo do modelo que respondeu', async () => {
    const h = await withUsage(
      { a: scripted(apiError(503)), b: scripted('de b') },
      ['fake:a', 'fake:b'],
      { 'fake:a': perToken, 'fake:b': perToken },
    );

    await h.ai.generate({ ...hi('resumo'), actor });

    // O observer roda sem ser esperado pelo `generate`.
    await vi.waitFor(() => expect(h.entries).toHaveLength(1));
    expect(h.entries).toEqual([
      {
        actor: actor.id,
        chatId: actor.chatId,
        action: 'resumo',
        kind: 'reply',
        outcome: 'ok',
        cost: 5,
      },
    ]);
  });

  it('modelo sem preço grava a resposta sem custo', async () => {
    const h = await withUsage({ a: scripted('oi') }, ['fake:a'], {});

    await h.ai.generate({ ...hi(), actor });

    await vi.waitFor(() => expect(h.entries).toHaveLength(1));
    expect(h.entries[0]).not.toHaveProperty('cost');
  });

  it('a cadeia toda em falha grava um erro, sem custo', async () => {
    const h = await withUsage(
      { a: scripted(apiError(503)), b: scripted(apiError(503)) },
      ['fake:a', 'fake:b'],
      { 'fake:a': perToken, 'fake:b': perToken },
    );

    await expect(h.ai.generate({ ...hi(), actor })).rejects.toThrow();

    await vi.waitFor(() => expect(h.entries).toHaveLength(1));
    expect(h.entries).toEqual([expect.objectContaining({ outcome: 'error' })]);
    expect(h.entries[0]).not.toHaveProperty('cost');
  });

  it('sem actor, nada vai para o usage', async () => {
    const h = await withUsage({ a: scripted('oi') }, ['fake:a'], { 'fake:a': perToken });

    await h.ai.generate(hi());

    expect(h.entries).toEqual([]);
  });
});

describe('config', () => {
  it('preço de modelo fora do formato provider:modelo impede o boot', async () => {
    await expect(
      createTestBot({
        plugins: [metrics, ai, aiMetrics],
        pluginConfig: {
          'ai-metrics': { prices: { gemini: { inputPerMillion: 1, outputPerMillion: 1 } } },
        },
      }),
    ).rejects.toThrow(/prices\.gemini/);
  });

  it('depende do metrics: sem ele o plugin não carrega', async () => {
    await expect(createTestBot({ plugins: [ai, aiMetrics] })).rejects.toThrow(/metrics/);
  });
});
