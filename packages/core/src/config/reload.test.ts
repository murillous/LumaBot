// Integração com o host real (M1-13.3): a fábrica de contexto de teste faz o que o `Bot` vai
// fazer no M1-16 — lê a config atual a cada setup com `configs.resolve`.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger, createNoopLogger } from '#logger/logger.ts';
import { createSecretSet } from '#logger/secrets.ts';
import { definePlugin } from '#plugin/define.ts';
import { createPluginHost, type PluginContextFactory, type PluginHost } from '#plugin/host.ts';
import type { PluginContext, PluginDefinition } from '#plugin/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { PluginConfigError } from './errors.ts';
import { createPluginConfigs, type PluginConfigs } from './plugin-configs.ts';
import { secret } from './schema.ts';

function harness(file: Record<string, Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const raw: string[] = [];
  const secrets = createSecretSet();
  const log = createLogger({ destination: { write: (line) => raw.push(line) }, secrets });

  const echo = definePlugin({
    name: 'echo',
    version: '1.0.0',
    engine: '^0.0.0',
    config: z.object({
      greeting: z.string().default('oi'),
      token: secret(z.string().min(4)).default('tok-inicial'),
    }),
    messages: { hello: 'Olá' },
    setup(ctx) {
      calls.push(`setup:${ctx.config.greeting}:${ctx.plugin.messages.hello}`);
      // Um plugin descuidado que loga a própria config: o token não pode sair.
      ctx.log.info('config carregada', { config: ctx.config });
    },
    teardown(ctx) {
      calls.push(`teardown:${ctx.config.greeting}`);
    },
  });
  const other = definePlugin({
    name: 'other',
    version: '1.0.0',
    engine: '^0.0.0',
    setup: () => {
      calls.push('setup:other');
    },
    teardown: () => {
      calls.push('teardown:other');
    },
  });

  let host: PluginHost | undefined;
  const configs: PluginConfigs = createPluginConfigs({
    plugins: [echo, other] as PluginDefinition[],
    file,
    storage: createMemoryStorage(),
    env: {},
    secrets,
    reload: (name) => (host as PluginHost).reload(name),
  });
  const createContext: PluginContextFactory = async (plugin) => {
    const { config, messages } = await configs.resolve(plugin.name);
    const context = {
      plugin: { name: plugin.name, version: plugin.version, messages },
      config,
      log: log.child({ plugin: plugin.name }),
    } as unknown as PluginContext;
    return { context, dispose: () => undefined };
  };
  host = createPluginHost({
    plugins: [echo, other].map((definition) => ({
      definition: definition as PluginDefinition,
      origin: 'config',
    })),
    transport: { name: 'fake', capabilities: new Set() },
    createContext,
    log: createNoopLogger(),
  });
  return { host, configs, calls, raw, secrets };
}

describe('reload por mudança de config', () => {
  it('setOverrides faz teardown → setup só do plugin, com a config nova', async () => {
    const { host, configs, calls } = harness();
    await host.start();
    expect(calls).toEqual(['setup:oi:Olá', 'setup:other']);

    calls.length = 0;
    const result = await configs.setOverrides('echo', {
      greeting: 'e aí',
      messages: { hello: 'Opa' },
    });
    expect(result?.entry.status).toBe('loaded');
    expect(calls).toEqual(['teardown:oi', 'setup:e aí:Opa']);
    expect(host.state).toBe('running');
  });

  it('config inválida é recusada e o plugin segue rodando com a anterior', async () => {
    const { host, configs, calls } = harness();
    await host.start();
    calls.length = 0;

    await expect(configs.setOverrides('echo', { greeting: 3 })).rejects.toBeInstanceOf(
      PluginConfigError,
    );
    expect(calls).toEqual([]);
    expect(host.report().find((entry) => entry.name === 'echo')?.status).toBe('loaded');
    expect((await configs.resolve('echo')).config).toMatchObject({ greeting: 'oi' });
  });

  it('config inválida no boot ignora o plugin, com o motivo na tabela', async () => {
    const { host, calls } = harness({ echo: { token: 'x' } });
    const table = await host.start();
    const echo = table.find((entry) => entry.name === 'echo');
    expect(echo?.status).toBe('skipped');
    if (echo?.status !== 'skipped' || echo.reason.kind !== 'setup-failed') {
      throw new Error('esperava setup-failed');
    }
    expect(echo.reason.error.phase).toBe('context');
    expect(echo.reason.error.cause).toBeInstanceOf(PluginConfigError);
    expect(calls).toEqual(['setup:other']);
  });

  it('o segredo inicial e o alterado no reload nunca aparecem no log', async () => {
    const { host, configs, raw } = harness();
    await host.start();
    await configs.setOverrides('echo', { token: 'tok-novo-999' });
    const output = raw.join('');
    expect(output).toContain('config carregada');
    expect(output).not.toMatch(/tok-inicial|tok-novo-999/);
  });
});
