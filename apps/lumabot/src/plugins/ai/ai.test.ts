import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { APICallError, jsonSchema, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { aiTool, ok } from '#plugins/ai-tools.ts';
import {
  type AiAttempt,
  type AiObserver,
  type AiProvider,
  type AiService,
  AiUnavailableError,
  ai,
} from './ai.ts';

let bot: TestBot;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-17T12:00:00Z') });
});

afterEach(async () => {
  await bot.stop();
  vi.useRealTimers();
});

const answer = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: {
    inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 2, text: 2, reasoning: undefined },
  },
  warnings: [],
});

const apiError = (statusCode: number) =>
  new APICallError({ message: `http ${statusCode}`, url: 'x', requestBodyValues: {}, statusCode });

/** Modelo falso que responde ou lança, na ordem das chamadas. */
const model = (...steps: (string | Error)[]) =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps.length > 1 ? steps.shift() : steps[0];
      if (step instanceof Error) throw step;
      return answer(step ?? '');
    },
  });

// Contribui providers falsos e pega o serviço, como um plugin de provider e um consumidor fariam.
let service: AiService | undefined;
let names: string[] = [];
const harness = (providers: AiProvider[], observers: AiObserver[] = []) =>
  definePlugin({
    name: 'harness',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0' },
    setup: (ctx) => {
      for (const p of providers) ctx.services.contribute('ai.providers', p);
      for (const o of observers) ctx.services.contribute('ai.observers', o);
      service = ctx.services.get('ai');
      names = ctx.services
        .extensionPoint('ai.providers')
        .list()
        .map((p) => p.name);
    },
  });

const fake = (name: string, models: Record<string, MockLanguageModelV4>): AiProvider => ({
  name,
  languageModel: (id) => {
    const m = models[id];
    if (!m) throw new Error(`modelo falso ausente: ${id}`);
    return m;
  },
});

async function start(
  models: { model: string; temperature?: number }[],
  providers: AiProvider[],
  observers: AiObserver[] = [],
) {
  bot = await createTestBot({
    plugins: [ai, harness(providers, observers)],
    pluginConfig: { ai: { models } },
  });
  if (!service) throw new Error('serviço não capturado');
  return service;
}

const hi = { purpose: 'teste', messages: [{ role: 'user' as const, content: 'oi' }] };

describe('ai.generate', () => {
  it('responde pelo primeiro modelo com instruções, mensagens e parâmetros do item', async () => {
    const a = model('olá');
    const ai = await start([{ model: 'fake:a', temperature: 0.7 }], [fake('fake', { a })]);

    const result = await ai.generate({ instructions: 'seja breve', ...hi });

    expect(result).toMatchObject({ text: 'olá', model: 'fake:a', usage: { inputTokens: 3 } });
    const call = a.doGenerateCalls[0];
    expect(call?.temperature).toBe(0.7);
    expect(call?.prompt).toEqual([
      { role: 'system', content: 'seja breve' },
      { role: 'user', content: [{ type: 'text', text: 'oi' }] },
    ]);
  });

  it('cai para o próximo provider em erro transitório', async () => {
    const a = model(apiError(503));
    const b = model('de b');
    const ai = await start(
      [{ model: 'fake:a' }, { model: 'outro:b' }],
      [fake('fake', { a }), fake('outro', { b })],
    );

    expect((await ai.generate(hi)).model).toBe('outro:b');
  });

  it('relança erro não transitório sem tentar o próximo', async () => {
    const b = model('de b');
    const ai = await start(
      [{ model: 'fake:a' }, { model: 'fake:b' }],
      [fake('fake', { a: model(apiError(400)), b })],
    );

    await expect(ai.generate(hi)).rejects.toMatchObject({ statusCode: 400 });
    expect(b.doGenerateCalls).toHaveLength(0);
  });

  it('manda o modelo em 429 para o fim da cadeia durante o cooldown', async () => {
    const a = model(apiError(429), 'de a');
    const b = model('de b');
    const ai = await start([{ model: 'fake:a' }, { model: 'fake:b' }], [fake('fake', { a, b })]);

    expect((await ai.generate(hi)).model).toBe('fake:b');
    expect((await ai.generate(hi)).model).toBe('fake:b');
    expect(a.doGenerateCalls).toHaveLength(1);

    vi.advanceTimersByTime(60_000);
    expect((await ai.generate(hi)).model).toBe('fake:a');
  });

  it('ainda tenta o modelo em cooldown quando é o único', async () => {
    const a = model(apiError(429), 'voltei');
    const ai = await start([{ model: 'fake:a' }], [fake('fake', { a })]);

    await expect(ai.generate(hi)).rejects.toBeInstanceOf(AiUnavailableError);
    expect((await ai.generate(hi)).text).toBe('voltei');
  });

  it('recusa com o último erro no cause quando todos falham', async () => {
    const ai = await start(
      [{ model: 'fake:a' }, { model: 'fake:b' }],
      [fake('fake', { a: model(apiError(500)), b: model(apiError(502)) })],
    );

    const err = await ai.generate(hi).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).cause).toMatchObject({ statusCode: 502 });
  });

  it('pula o item cujo provider não está registrado', async () => {
    const ai = await start(
      [{ model: 'sumido:x' }, { model: 'fake:a' }],
      [fake('fake', { a: model('ok') })],
    );

    expect((await ai.generate(hi)).model).toBe('fake:a');
  });

  it('não tenta o próximo quando quem chamou abortou', async () => {
    const controller = new AbortController();
    const b = model('de b');
    const a = new MockLanguageModelV4({
      doGenerate: async () => {
        controller.abort();
        throw Object.assign(new Error('abortado'), { name: 'AbortError' });
      },
    });
    const ai = await start([{ model: 'fake:a' }, { model: 'fake:b' }], [fake('fake', { a, b })]);

    await expect(ai.generate({ ...hi, signal: controller.signal })).rejects.toThrow();
    expect(b.doGenerateCalls).toHaveLength(0);
  });

  it('sem cadeia o bot sobe e o generate recusa', async () => {
    const ai = await start([], []);

    await expect(ai.generate(hi)).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe('ai.observers', () => {
  it('recebe cada tentativa com posição, desfecho, uso e latência', async () => {
    const seen: AiAttempt[] = [];
    const slow = new MockLanguageModelV4({
      doGenerate: async () => {
        vi.advanceTimersByTime(250);
        return answer('de b');
      },
    });
    const ai = await start(
      [{ model: 'sumido:x' }, { model: 'fake:a' }, { model: 'fake:b' }],
      [fake('fake', { a: model(apiError(503)), b: slow })],
      [(a) => void seen.push(a)],
    );

    await ai.generate(hi);

    expect(seen).toMatchObject([
      { model: 'sumido:x', provider: 'sumido', position: 0, outcome: 'unregistered' },
      { model: 'fake:a', position: 1, outcome: 'transient', statusCode: 503 },
      {
        model: 'fake:b',
        provider: 'fake',
        purpose: 'teste',
        position: 2,
        outcome: 'ok',
        latencyMs: 250,
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    ]);
    expect(seen[1]?.usage).toBeUndefined();
  });

  it('registra o erro que relança e o abort de quem chamou', async () => {
    const seen: AiAttempt['outcome'][] = [];
    const controller = new AbortController();
    let call = 0;
    const a = new MockLanguageModelV4({
      doGenerate: async () => {
        call += 1;
        if (call === 1) throw apiError(400);
        controller.abort();
        throw Object.assign(new Error('abortado'), { name: 'AbortError' });
      },
    });
    const ai = await start(
      [{ model: 'fake:a' }],
      [fake('fake', { a })],
      [(attempt) => void seen.push(attempt.outcome)],
    );

    await expect(ai.generate(hi)).rejects.toThrow();
    await expect(ai.generate({ ...hi, signal: controller.signal })).rejects.toThrow();

    expect(seen).toEqual(['error', 'aborted']);
  });

  it('observer que falha não quebra a geração', async () => {
    const ai = await start(
      [{ model: 'fake:a' }],
      [fake('fake', { a: model('ok') })],
      [
        () => {
          throw new Error('síncrono');
        },
        async () => {
          throw new Error('assíncrono');
        },
      ],
    );

    expect((await ai.generate(hi)).text).toBe('ok');
  });
});

describe('ai.providers', () => {
  it('contribui só os embutidos com chave', async () => {
    bot = await createTestBot({
      plugins: [ai, harness([])],
      pluginConfig: { ai: { keys: { google: 'g-key', anthropic: 'a-key' } } },
    });

    expect(names).toEqual(['google', 'anthropic']);
  });

  it('rejeita item da cadeia sem provider:modelo', async () => {
    await expect(
      createTestBot({ plugins: [ai], pluginConfig: { ai: { models: [{ model: 'gemini' }] } } }),
    ).rejects.toThrow(/provider:modelo/);
    bot = await createTestBot({ plugins: [] });
  });
});

describe('ai.generate com models por chamada', () => {
  it('percorre só a cadeia da chamada, com fallback entre os itens', async () => {
    const principal = model('da principal');
    const a = model(apiError(503));
    const b = model('de b');
    const ai = await start([{ model: 'fake:principal' }], [fake('fake', { principal, a, b })]);

    const result = await ai.generate({ ...hi, models: [{ model: 'fake:a' }, { model: 'fake:b' }] });

    expect(result.model).toBe('fake:b');
    expect(principal.doGenerateCalls).toHaveLength(0);
  });

  it('usa os parâmetros do item da chamada', async () => {
    const a = model('ok');
    const ai = await start([{ model: 'fake:principal', temperature: 1 }], [fake('fake', { a })]);

    await ai.generate({ ...hi, models: [{ model: 'fake:a', temperature: 0.2 }] });

    expect(a.doGenerateCalls[0]?.temperature).toBe(0.2);
  });

  it('sem models, ou vazio, vale a cadeia principal', async () => {
    const principal = model('da principal');
    const ai = await start([{ model: 'fake:principal' }], [fake('fake', { principal })]);

    expect((await ai.generate(hi)).model).toBe('fake:principal');
    expect((await ai.generate({ ...hi, models: [] })).model).toBe('fake:principal');
  });

  it('funciona mesmo sem cadeia principal', async () => {
    const a = model('ok');
    const ai = await start([], [fake('fake', { a })]);

    expect((await ai.generate({ ...hi, models: [{ model: 'fake:a' }] })).text).toBe('ok');
  });

  it('o 429 da cadeia principal vale para a da chamada (cooldown compartilhado)', async () => {
    const a = model(apiError(429), 'de a');
    const b = model('de b');
    const ai = await start([{ model: 'fake:a' }], [fake('fake', { a, b })]);

    await expect(ai.generate(hi)).rejects.toBeInstanceOf(AiUnavailableError);
    const result = await ai.generate({ ...hi, models: [{ model: 'fake:a' }, { model: 'fake:b' }] });

    expect(result.model).toBe('fake:b');
    expect(a.doGenerateCalls).toHaveLength(1);
  });

  it('o 429 da cadeia da chamada vale para a principal', async () => {
    const a = model(apiError(429), 'de a');
    const b = model('de b');
    const ai = await start([{ model: 'fake:a' }, { model: 'fake:b' }], [fake('fake', { a, b })]);

    await ai.generate({ ...hi, models: [{ model: 'fake:a' }, { model: 'fake:b' }] });

    expect((await ai.generate(hi)).model).toBe('fake:b');
    expect(a.doGenerateCalls).toHaveLength(1);
  });

  it('pula o item sem provider e notifica os observers com purpose e model da chamada', async () => {
    const seen: AiAttempt[] = [];
    const ai = await start(
      [{ model: 'fake:principal' }],
      [fake('fake', { a: model('ok'), principal: model('x') })],
      [(attempt) => void seen.push(attempt)],
    );

    await ai.generate({
      ...hi,
      purpose: 'transcribe',
      models: [{ model: 'sumido:x' }, { model: 'fake:a' }],
    });

    expect(seen).toMatchObject([
      { model: 'sumido:x', purpose: 'transcribe', outcome: 'unregistered' },
      { model: 'fake:a', purpose: 'transcribe', position: 1, outcome: 'ok' },
    ]);
  });

  it('recusa item fora do formato provider:modelo sem chamar ninguém', async () => {
    const principal = model('x');
    const ai = await start([{ model: 'fake:principal' }], [fake('fake', { principal })]);

    await expect(ai.generate({ ...hi, models: [{ model: 'gemini' }] })).rejects.toThrow(
      /provider:modelo/,
    );
    expect(principal.doGenerateCalls).toHaveLength(0);
  });

  it('recusa parâmetro fora da faixa', async () => {
    const ai = await start([], [fake('fake', { a: model('x') })]);

    await expect(
      ai.generate({ ...hi, models: [{ model: 'fake:a', temperature: 5 }] }),
    ).rejects.toThrow();
  });
});

describe('ai.generate com tools', () => {
  const toolCall = (name: string, input: unknown) => ({
    content: [
      { type: 'text' as const, text: 'já vi' },
      {
        type: 'tool-call' as const,
        toolCallId: `call-${name}`,
        toolName: name,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
    usage: answer('').usage,
    warnings: [],
  });

  /** Modelo que chama a tool no 1º passo e responde no 2º, guardando o que recebeu. */
  const toolModel = (name: string, input: unknown, final = 'feito') => {
    let step = 0;
    return new MockLanguageModelV4({
      doGenerate: async () => (step++ === 0 ? toolCall(name, input) : answer(final)),
    });
  };

  // Plugin consumidor: contribui as tools e chama o `generate` com o contexto de um comando.
  let last: Awaited<ReturnType<AiService['generate']>> | undefined;
  const runs: unknown[] = [];
  const caller = (providers: AiProvider[]) =>
    definePlugin({
      name: 'caller',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { ai: '^0.1.0' },
      setup: (ctx) => {
        for (const p of providers) ctx.services.contribute('ai.providers', p);
        ctx.services.contribute(
          'ai.tools',
          aiTool({
            name: 'echo',
            description: 'devolve o texto',
            args: z.object({ text: z.string() }),
            run: async ({ text }) => {
              runs.push(text);
              return ok({ echoed: text });
            },
          }),
        );
        ctx.services.contribute(
          'ai.tools',
          aiTool({
            name: 'only_sticker',
            description: 'precisa de figurinha',
            args: z.object({}),
            requires: ['send.sticker'],
            run: async () => ok(),
          }),
        );
        ctx.commands.add({
          name: 'ask',
          run: async (c) => {
            last = await ctx.services.get('ai').generate({
              ...hi,
              toolContext: { message: c.message, reply: c.reply, signal: c.signal, log: c.log },
            });
            return last.text;
          },
        });
      },
    });

  // Tools extras vivem num plugin à parte para não mudar o que o `caller` oferece aos outros testes.
  // A `slow` fica pendurada aqui até o teste soltar: simula uma tool ainda rodando no timeout.
  let slowGate: Promise<void> = Promise.resolve();
  const extras = definePlugin({
    name: 'extras',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0' },
    setup: (ctx) => {
      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'slow',
          description: 'demora e tem efeito',
          args: z.object({}),
          run: async () => {
            runs.push('slow');
            await slowGate;
            return ok();
          },
        }),
      );
      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'peek',
          description: 'só leitura',
          args: z.object({}),
          sideEffects: false,
          run: async () => {
            runs.push('peek');
            return ok();
          },
        }),
      );
    },
  });

  async function ask(
    chain: Record<string, MockLanguageModelV4>,
    profile?: 'web',
    timeoutMs?: number,
    withExtras = false,
  ) {
    runs.length = 0;
    last = undefined;
    bot = await createTestBot({
      plugins: [ai, caller([fake('fake', chain)]), ...(withExtras ? [extras] : [])],
      pluginConfig: {
        ai: {
          models: [{ model: 'fake:a' }, { model: 'fake:b' }],
          ...(timeoutMs ? { timeoutMs } : {}),
        },
      },
      ...(profile ? { profile } : {}),
    });
    await bot.receive({ text: '!ask' });
  }

  it('oferece as tools ao modelo, roda a chamada e devolve o resultado a ele', async () => {
    const a = toolModel('echo', { text: 'oi' });
    await ask({ a });

    expect(runs).toEqual(['oi']);
    expect(last?.toolCalls).toEqual([
      { name: 'echo', args: { text: 'oi' }, result: { ok: true, echoed: 'oi' } },
    ]);
    expect(last?.text).toBe('feito');
    const offered = a.doGenerateCalls[0]?.tools?.map((t) => t.name);
    expect(offered).toContain('echo');
    // O resultado da tool volta para o modelo no 2º passo.
    expect(JSON.stringify(a.doGenerateCalls[1]?.prompt)).toContain('echoed');
  });

  it('não oferece a tool cujo transport não tem a capability', async () => {
    const a = toolModel('echo', { text: 'oi' });
    await ask({ a }, 'web');

    const offered = a.doGenerateCalls[0]?.tools?.map((t) => t.name);
    expect(offered).toEqual(['echo']);
  });

  it('argumento inválido volta ao modelo como invalid-args, sem rodar a tool', async () => {
    const a = toolModel('echo', { text: 42 });
    await ask({ a });

    expect(runs).toEqual([]);
    expect(last?.toolCalls[0]?.result).toMatchObject({ ok: false, error: 'invalid-args' });
    expect(last?.text).toBe('feito');
  });

  it('sem toolContext a chamada é só texto', async () => {
    const a = model('oi');
    const generate = await start([{ model: 'fake:a' }], [fake('fake', { a })]);

    const result = await generate.generate(hi);

    expect(a.doGenerateCalls[0]?.tools).toBeUndefined();
    expect(result.toolCalls).toEqual([]);
  });

  it('se o modelo falha depois de uma tool rodar, não repete a tool no próximo modelo', async () => {
    let step = 0;
    const a = new MockLanguageModelV4({
      doGenerate: async () => {
        if (step++ === 0) return toolCall('echo', { text: 'uma vez' });
        throw apiError(503);
      },
    });
    const b = model('de b');
    await ask({ a, b }).catch(() => undefined);

    expect(runs).toEqual(['uma vez']);
    expect(b.doGenerateCalls).toHaveLength(0);
  });

  it('tool com efeito lenta que estoura o timeout roda uma vez só e o erro é relançado', async () => {
    // O timeout do SDK usa timers reais; com os falsos ele nunca dispararia.
    vi.useRealTimers();
    let release: () => void = () => undefined;
    slowGate = new Promise<void>((r) => {
      release = r;
    });
    const a = toolModel('slow', {});
    // `b` chamaria a tool de novo: se o fallback ocorresse, `runs` teria dois 'slow'.
    const b = toolModel('slow', {});
    const asked = ask({ a, b }, undefined, 50, true).catch(() => undefined);
    // Hoje o SDK espera a tool e lança depois; se passar a lançar com ela pendente, este teste pega a repetição.
    await new Promise((r) => setTimeout(r, 300));
    release();
    await asked;

    // A resposta não veio: o erro do timeout foi relançado em vez de cair no `b`.
    expect(last).toBeUndefined();
    expect(runs).toEqual(['slow']);
    expect(b.doGenerateCalls).toHaveLength(0);
  });

  it('tool só de leitura não bloqueia o fallback para o próximo modelo', async () => {
    let step = 0;
    const a = new MockLanguageModelV4({
      doGenerate: async () => {
        if (step++ === 0) return toolCall('peek', {});
        throw apiError(503);
      },
    });
    await ask({ a, b: model('de b') }, undefined, undefined, true);

    expect(runs).toEqual(['peek']);
    expect(last?.text).toBe('de b');
  });

  it('usa o texto dos passos anteriores quando o último vem vazio', async () => {
    let step = 0;
    const a = new MockLanguageModelV4({
      doGenerate: async () => (step++ === 0 ? toolCall('echo', { text: 'x' }) : answer('')),
    });
    await ask({ a });

    expect(last?.text).toBe('já vi');
  });
});

describe('ai.generate com busca nativa', () => {
  const searchTool = () => ({
    web: tool({
      description: 'busca',
      inputSchema: jsonSchema<unknown>({ type: 'object', properties: {} }),
      execute: async () => 'achei',
    }),
  });

  it('oferece a busca do provider e pula o item cujo provider não tem', async () => {
    const noSearch = model('sem busca');
    const withSearch = model('com busca');
    const ai = await start(
      [{ model: 'plain:a' }, { model: 'smart:b' }],
      [
        fake('plain', { a: noSearch }),
        { ...fake('smart', { b: withSearch }), nativeSearch: searchTool },
      ],
    );

    const result = await ai.generate({ ...hi, nativeSearch: true });

    expect(result.model).toBe('smart:b');
    expect(noSearch.doGenerateCalls).toHaveLength(0);
    expect(withSearch.doGenerateCalls[0]?.tools?.map((t) => t.name)).toEqual(['web']);
  });

  it('sem nativeSearch, a busca do provider não é oferecida', async () => {
    const a = model('ok');
    const ai = await start(
      [{ model: 'smart:a' }],
      [{ ...fake('smart', { a }), nativeSearch: searchTool }],
    );

    await ai.generate(hi);

    expect(a.doGenerateCalls[0]?.tools).toBeUndefined();
  });

  it('nenhum item com busca: recusa, em vez de responder sem buscar', async () => {
    const ai = await start([{ model: 'plain:a' }], [fake('plain', { a: model('x') })]);

    await expect(ai.generate({ ...hi, nativeSearch: true })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it('o Gemini embutido traz a busca; os outros embutidos, não', async () => {
    let listed: AiProvider[] = [];
    const spy = definePlugin({
      name: 'spy',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { ai: '^0.1.0' },
      setup: (ctx) => {
        listed = [...ctx.services.extensionPoint('ai.providers').list()];
      },
    });
    bot = await createTestBot({
      plugins: [ai, spy],
      pluginConfig: { ai: { keys: { google: 'g-key', openai: 'o-key' } } },
    });

    const byName = Object.fromEntries(listed.map((p) => [p.name, p]));
    expect(Object.keys(byName['google']?.nativeSearch?.() ?? {})).toEqual(['google_search']);
    expect(byName['openai']?.nativeSearch).toBeUndefined();
  });
});
