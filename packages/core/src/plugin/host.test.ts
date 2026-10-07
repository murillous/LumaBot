import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger, LogLevel } from '#logger/types.ts';
import type { Capability, CapabilityHolder } from '#transport/capabilities.ts';
import { PluginManifestError } from './define.ts';
import {
  createPluginHost,
  PluginConflictError,
  type PluginContextFactory,
  type PluginHostOptions,
  PluginHostStateError,
} from './host.ts';
import { PluginCycleError } from './order.ts';
import { formatBootTable, type PluginReportEntry } from './report.ts';
import type { PluginEntry } from './sources.ts';
import type { PluginContext, PluginDefinition } from './types.ts';

interface LogLine {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

function fakeLogger(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const at =
    (level: LogLevel) =>
    (message: string, fields?: Readonly<Record<string, unknown>>): void => {
      lines.push({ level, message, fields });
    };
  const logger: Logger & { lines: LogLine[] } = {
    lines,
    level: 'trace',
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: () => logger,
  };
  return logger;
}

const transport = (name: string, capabilities: Capability[]): CapabilityHolder => ({
  name,
  capabilities: new Set(capabilities),
});

/** Nunca termina. */
const pending = (): Promise<void> => new Promise<void>(() => undefined);

type Overrides = Partial<Omit<PluginDefinition, 'setup'>> & { setup?: PluginDefinition['setup'] };

function plugin(name: string, overrides: Overrides = {}): PluginDefinition {
  return { name, version: '1.0.0', engine: '^1.0.0', setup: () => undefined, ...overrides };
}

const entries = (...plugins: PluginDefinition[]): PluginEntry[] =>
  plugins.map((definition) => ({ definition, origin: 'config' }));

/** Fábrica que registra criação e dispose de cada contexto, na ordem em que acontecem. */
function recordingFactory(calls: string[]): PluginContextFactory {
  return (definition) => {
    calls.push(`context:${definition.name}`);
    return {
      context: { plugin: { name: definition.name } } as unknown as PluginContext,
      dispose: () => {
        calls.push(`dispose:${definition.name}`);
      },
    };
  };
}

function host(plugins: PluginDefinition[], options: Partial<PluginHostOptions> = {}) {
  const calls: string[] = [];
  const log = fakeLogger();
  const created = createPluginHost({
    plugins: entries(...plugins),
    transport: transport('baileys', ['groups', 'send.text', 'send.sticker']),
    createContext: recordingFactory(calls),
    log,
    coreVersion: '1.4.0',
    ...options,
  });
  return { host: created, calls, log };
}

const statusOf = (table: readonly PluginReportEntry[]) =>
  Object.fromEntries(
    table.map((entry) => [entry.name, entry.status === 'loaded' ? 'loaded' : entry.reason.kind]),
  );

describe('createPluginHost — boot', () => {
  it('roda setup em ordem topológica e devolve a tabela', async () => {
    const order: string[] = [];
    const { host: h } = host([
      plugin('resumo', { dependsOn: { ai: '^1.0.0' }, setup: () => void order.push('resumo') }),
      plugin('ai', { setup: () => void order.push('ai') }),
      plugin('ping', { priority: 5, setup: () => void order.push('ping') }),
    ]);
    const table = await h.start();
    expect(order).toEqual(['ping', 'ai', 'resumo']);
    expect(table.map((entry) => entry.name)).toEqual(['ping', 'ai', 'resumo']);
    expect(statusOf(table)).toEqual({ ping: 'loaded', ai: 'loaded', resumo: 'loaded' });
    expect(h.state).toBe('running');
  });

  it('setup recebe o contexto da fábrica', async () => {
    const setup = vi.fn();
    const { host: h } = host([plugin('ping', { setup })]);
    await h.start();
    expect(setup).toHaveBeenCalledWith({ plugin: { name: 'ping' } });
  });

  it('plugin incompatível (engine/transports/requires) não carrega e mostra o motivo', async () => {
    const setup = vi.fn();
    const { host: h, log } = host([
      plugin('velho', { engine: '^2.0.0', setup }),
      plugin('telegram-only', { transports: ['telegram'], setup }),
      plugin('enquete', { requires: ['polls', 'send.text', 'reactions'], setup }),
      plugin('ok', { transports: ['baileys'], requires: ['send.sticker'] }),
    ]);
    const table = await h.start();
    expect(setup).not.toHaveBeenCalled();
    expect(table).toEqual([
      {
        name: 'velho',
        version: '1.0.0',
        origin: 'config',
        status: 'skipped',
        reason: { kind: 'engine', range: '^2.0.0', coreVersion: '1.4.0' },
      },
      {
        name: 'telegram-only',
        version: '1.0.0',
        origin: 'config',
        status: 'skipped',
        reason: { kind: 'transport', expected: ['telegram'], actual: 'baileys' },
      },
      {
        name: 'enquete',
        version: '1.0.0',
        origin: 'config',
        status: 'skipped',
        reason: { kind: 'capabilities', missing: ['polls', 'reactions'] },
      },
      { name: 'ok', version: '1.0.0', origin: 'config', status: 'loaded' },
    ]);
    const tableLine = log.lines.find((line) => line.message.startsWith('Plugins:'));
    expect(tableLine?.level).toBe('warn');
    expect(tableLine?.message).toContain(
      'engine incompatível: exige core ^2.0.0, versão atual 1.4.0',
    );
    expect(tableLine?.message).toContain('transport diferente: exige telegram, atual baileys');
    expect(tableLine?.message).toContain('capability ausente no transport: polls, reactions');
    expect(tableLine?.fields?.['plugins']).toContainEqual({
      name: 'enquete',
      version: '1.0.0',
      origin: 'config',
      status: 'skipped',
      reason: 'capability ausente no transport: polls, reactions',
    });
  });

  it('tudo carregado: tabela em info', async () => {
    const { host: h, log } = host([plugin('ping')]);
    await h.start();
    expect(log.lines.find((line) => line.message.startsWith('Plugins:'))?.level).toBe('info');
  });

  it('usa CORE_VERSION quando coreVersion não é passada', async () => {
    const { host: h } = host(
      [plugin('dev', { engine: '>=0.0.0' }), plugin('futuro', { engine: '^99.0.0' })],
      {
        coreVersion: undefined,
      },
    );
    expect(statusOf(await h.start())).toEqual({ dev: 'loaded', futuro: 'engine' });
  });

  it('disabledPlugins desliga por nome e avisa nome desconhecido', async () => {
    const setup = vi.fn();
    const { host: h, log } = host([plugin('ping', { setup }), plugin('pong')], {
      disabledPlugins: ['ping', 'pnig'],
    });
    expect(statusOf(await h.start())).toEqual({ ping: 'disabled', pong: 'loaded' });
    expect(setup).not.toHaveBeenCalled();
    expect(log.lines).toContainEqual(
      expect.objectContaining({ level: 'warn', message: expect.stringContaining('"pnig"') }),
    );
  });

  it('ignorado propaga para quem depende, em cadeia', async () => {
    const { host: h } = host(
      [
        plugin('ai'),
        plugin('resumo', { dependsOn: { ai: '^1.0.0' } }),
        plugin('digest', { dependsOn: { resumo: '*' } }),
        plugin('solto'),
      ],
      { disabledPlugins: ['ai'] },
    );
    const table = await h.start();
    expect(statusOf(table)).toEqual({
      ai: 'disabled',
      resumo: 'dependency-skipped',
      digest: 'dependency-skipped',
      solto: 'loaded',
    });
    expect(formatBootTable(table)).toContain('dependência ignorada: ai');
  });

  it('dependência ausente ou com versão incompatível', async () => {
    const { host: h } = host([
      plugin('ai', { version: '0.9.0' }),
      plugin('resumo', { dependsOn: { ai: '^1.0.0' } }),
      plugin('agenda', { dependsOn: { 'user-names': '^1.0.0' } }),
    ]);
    const table = await h.start();
    expect(table.find((entry) => entry.name === 'resumo')).toMatchObject({
      status: 'skipped',
      reason: { kind: 'dependency-version', dependency: 'ai', range: '^1.0.0', version: '0.9.0' },
    });
    expect(table.find((entry) => entry.name === 'agenda')).toMatchObject({
      status: 'skipped',
      reason: { kind: 'dependency-missing', dependency: 'user-names' },
    });
    expect(formatBootTable(table)).toContain('ai@0.9.0 não satisfaz ^1.0.0');
  });

  it('ciclo de dependência falha o boot sem rodar setup', async () => {
    const setup = vi.fn();
    const { host: h, calls } = host([
      plugin('a', { dependsOn: { b: '*' }, setup }),
      plugin('b', { dependsOn: { a: '*' }, setup }),
    ]);
    await expect(h.start()).rejects.toThrow(PluginCycleError);
    expect(setup).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(h.state).toBe('stopped');
  });

  it('nome duplicado falha o boot com as duas origens', async () => {
    const h = createPluginHost({
      plugins: [
        { definition: plugin('ping'), origin: 'config' },
        { definition: plugin('ping'), origin: '/app/plugins/ping.ts' },
      ],
      transport: transport('baileys', []),
      createContext: recordingFactory([]),
      log: fakeLogger(),
      coreVersion: '1.0.0',
    });
    const error = await h.start().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PluginConflictError);
    expect((error as PluginConflictError).origins).toEqual(['config', '/app/plugins/ping.ts']);
  });

  it('manifesto malformado falha o boot', async () => {
    const { host: h } = host([plugin('Ping')]);
    await expect(h.start()).rejects.toThrow(PluginManifestError);
  });

  it('coreVersion inválida é erro na criação', () => {
    expect(() => host([], { coreVersion: 'dev' })).toThrow(RangeError);
  });

  it('start() só uma vez', async () => {
    const { host: h } = host([]);
    await h.start();
    await expect(h.start()).rejects.toThrow(PluginHostStateError);
  });
});

describe('createPluginHost — setup/teardown com timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('setup que falha vira ignorado, faz dispose e não derruba o boot nem os outros', async () => {
    const {
      host: h,
      calls,
      log,
    } = host([
      plugin('ai', {
        setup: () => {
          throw new Error('sem chave de API');
        },
      }),
      plugin('resumo', { dependsOn: { ai: '*' } }),
      plugin('ping'),
    ]);
    const table = await h.start();
    expect(statusOf(table)).toEqual({
      ai: 'setup-failed',
      resumo: 'dependency-skipped',
      ping: 'loaded',
    });
    expect(calls).toEqual(['context:ai', 'dispose:ai', 'context:ping']);
    expect(formatBootTable(table)).toContain('falha no setup: sem chave de API');
    expect(log.lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        fields: expect.objectContaining({ plugin: 'ai', phase: 'setup', err: expect.any(Error) }),
      }),
    );
  });

  it('setup que estoura o prazo vira ignorado com timedOut', async () => {
    const { host: h, calls } = host([plugin('lento', { setup: pending }), plugin('ping')], {
      setupTimeoutMs: 1000,
    });
    const started = h.start();
    await vi.advanceTimersByTimeAsync(1000);
    const table = await started;
    const lento = table[0];
    expect(lento?.status === 'skipped' && lento.reason).toMatchObject({
      kind: 'setup-failed',
      error: { phase: 'setup', timedOut: true },
    });
    expect(formatBootTable(table)).toContain('falha no setup: excedeu 1000 ms');
    expect(calls).toEqual(['context:lento', 'dispose:lento', 'context:ping']);
  });

  it('prazo padrão de setup é 10 s', async () => {
    const { host: h } = host([plugin('lento', { setup: pending })]);
    const started = h.start();
    await vi.advanceTimersByTimeAsync(9999);
    expect(h.state).toBe('starting');
    await vi.advanceTimersByTimeAsync(1);
    expect(statusOf(await started)).toEqual({ lento: 'setup-failed' });
  });

  it('setup que rejeita depois do timeout não vira rejeição não tratada', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { host: h } = host(
        [
          plugin('tardio', {
            setup: () =>
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error('tarde')), 2000)),
          }),
        ],
        { setupTimeoutMs: 1000 },
      );
      const started = h.start();
      await vi.advanceTimersByTimeAsync(3000);
      await started;
      await vi.runAllTimersAsync();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('falha da fábrica de contexto também vira ignorado', async () => {
    const { host: h } = host([plugin('ping')], {
      createContext: () => {
        throw new Error('storage fora');
      },
    });
    const table = await h.start();
    expect(formatBootTable(table)).toContain('falha na criação do contexto: storage fora');
  });

  it('stop: teardown em ordem inversa, dispose depois de cada teardown', async () => {
    const calls: string[] = [];
    const teardown = (name: string) => () => void calls.push(`teardown:${name}`);
    const h = createPluginHost({
      plugins: entries(
        plugin('b', { dependsOn: { a: '*' }, teardown: teardown('b') }),
        plugin('a', { teardown: teardown('a') }),
        plugin('c', { after: ['b'] }),
      ),
      transport: transport('baileys', []),
      createContext: recordingFactory(calls),
      log: fakeLogger(),
      coreVersion: '1.0.0',
    });
    await h.start();
    calls.length = 0;
    expect(await h.stop()).toEqual([]);
    expect(calls).toEqual(['dispose:c', 'teardown:b', 'dispose:b', 'teardown:a', 'dispose:a']);
    expect(h.state).toBe('stopped');
  });

  it('stop não chama teardown de quem não carregou', async () => {
    const teardown = vi.fn();
    const { host: h } = host([plugin('off', { teardown })], { disabledPlugins: ['off'] });
    await h.start();
    await h.stop();
    expect(teardown).not.toHaveBeenCalled();
  });

  it('falha e timeout de teardown não impedem o teardown dos outros e voltam no retorno', async () => {
    const calls: string[] = [];
    const { host: h, log } = host(
      [
        plugin('a', { teardown: () => void calls.push('teardown:a') }),
        plugin('b', { teardown: pending }),
        plugin('c', {
          teardown: () => {
            throw new Error('quebrou');
          },
        }),
      ],
      { teardownTimeoutMs: 500 },
    );
    await h.start();
    const stopped = h.stop();
    await vi.advanceTimersByTimeAsync(500);
    const errors = await stopped;
    expect(errors.map((error) => [error.plugin, error.phase, error.timedOut])).toEqual([
      ['c', 'teardown', false],
      ['b', 'teardown', true],
    ]);
    expect((errors[0]?.cause as Error | undefined)?.message).toBe('quebrou');
    expect(calls).toContain('teardown:a');
    expect(log.lines.filter((line) => line.level === 'error')).toHaveLength(2);
  });

  it('stop abortado abandona o teardown em curso, pula os seguintes e faz dispose de todos', async () => {
    const teardownA = vi.fn();
    const { host: h, calls } = host(
      [plugin('a', { teardown: teardownA }), plugin('b', { teardown: pending })],
      { teardownTimeoutMs: 60_000 },
    );
    await h.start();
    const controller = new AbortController();
    const stopped = h.stop(controller.signal);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const errors = await stopped;

    expect(errors.map((error) => [error.plugin, error.phase, error.timedOut])).toEqual([
      ['b', 'teardown', true],
      ['a', 'teardown', true],
    ]);
    expect(teardownA).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.startsWith('dispose'))).toEqual(['dispose:b', 'dispose:a']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose que falha também volta no retorno', async () => {
    const { host: h } = host([plugin('ping')], {
      createContext: () => ({
        context: {} as PluginContext,
        dispose: () => {
          throw new Error('listener preso');
        },
      }),
    });
    await h.start();
    const errors = await h.stop();
    expect(errors.map((error) => error.phase)).toEqual(['dispose']);
  });

  it('stop é idempotente e espera o boot em andamento', async () => {
    const teardown = vi.fn();
    const { host: h } = host([
      plugin('lento', { setup: () => new Promise((r) => setTimeout(r, 100)), teardown }),
    ]);
    const started = h.start();
    const first = h.stop();
    expect(h.stop()).toBe(first);
    await vi.advanceTimersByTimeAsync(100);
    await started;
    await first;
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(h.state).toBe('stopped');
  });

  it('stop antes do start encerra sem rodar nada', async () => {
    const { host: h, calls } = host([plugin('ping')]);
    expect(await h.stop()).toEqual([]);
    expect(calls).toEqual([]);
    await expect(h.start()).rejects.toThrow(PluginHostStateError);
  });
});

describe('createPluginHost — reload', () => {
  it('recarrega só o plugin pedido: teardown, dispose, contexto novo, setup', async () => {
    const calls: string[] = [];
    let generation = 0;
    const h = createPluginHost({
      plugins: entries(
        plugin('ai', {
          setup: () => void calls.push(`setup:ai#${++generation}`),
          teardown: () => void calls.push('teardown:ai'),
        }),
        plugin('ping', { teardown: () => void calls.push('teardown:ping') }),
      ),
      transport: transport('baileys', []),
      createContext: recordingFactory(calls),
      log: fakeLogger(),
      coreVersion: '1.0.0',
    });
    await h.start();
    calls.length = 0;
    const result = await h.reload('ai');
    expect(calls).toEqual(['teardown:ai', 'dispose:ai', 'context:ai', 'setup:ai#2']);
    expect(result).toEqual({
      entry: { name: 'ai', version: '1.0.0', origin: 'config', status: 'loaded' },
      errors: [],
    });
  });

  it('setup novo que falha deixa o plugin ignorado; reload seguinte pode recuperar', async () => {
    let broken = true;
    const { host: h } = host([
      plugin('ai', {
        setup: () => {
          if (broken) throw new Error('config ruim');
        },
      }),
    ]);
    expect(statusOf(await h.start())).toEqual({ ai: 'setup-failed' });
    broken = false;
    const result = await h.reload('ai');
    expect(result.entry.status).toBe('loaded');
    expect(statusOf(h.report())).toEqual({ ai: 'loaded' });
  });

  it('devolve falhas do teardown anterior', async () => {
    const { host: h } = host([
      plugin('ai', {
        teardown: () => {
          throw new Error('x');
        },
      }),
    ]);
    await h.start();
    const result = await h.reload('ai');
    expect(result.errors.map((error) => error.phase)).toEqual(['teardown']);
    expect(result.entry.status).toBe('loaded');
  });

  it('recusa plugin desconhecido, ignorado por incompatibilidade ou host fora de running', async () => {
    const { host: h } = host([plugin('off')], { disabledPlugins: ['off'] });
    await expect(h.reload('off')).rejects.toThrow(PluginHostStateError);
    await h.start();
    await expect(h.reload('nada')).rejects.toThrow(/desconhecido/);
    await expect(h.reload('off')).rejects.toThrow(/desabilitado/);
    await h.stop();
    await expect(h.reload('off')).rejects.toThrow(/stopped/);
  });

  it('stop pedido durante reload espera o reload terminar', async () => {
    const calls: string[] = [];
    let resolveSetup: (() => void) | undefined;
    let first = true;
    const h = createPluginHost({
      plugins: entries(
        plugin('ai', {
          setup: () => {
            if (first) {
              first = false;
              return;
            }
            return new Promise<void>((resolve) => {
              resolveSetup = resolve;
            });
          },
          teardown: () => void calls.push('teardown:ai'),
        }),
      ),
      transport: transport('baileys', []),
      createContext: recordingFactory(calls),
      log: fakeLogger(),
      coreVersion: '1.0.0',
    });
    await h.start();
    const reloading = h.reload('ai');
    const stopping = h.stop();
    await vi.waitFor(() => expect(resolveSetup).toBeDefined());
    resolveSetup?.();
    await reloading;
    await stopping;
    expect(calls.filter((call) => call.startsWith('teardown'))).toEqual([
      'teardown:ai',
      'teardown:ai',
    ]);
    expect(h.state).toBe('stopped');
  });
});
