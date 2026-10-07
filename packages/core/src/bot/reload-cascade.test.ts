// Reload em cascata (#226, ADR 0041): recarregar um plugin que provê serviço recarrega quem
// depende dele, para nenhum dependente ficar com a instância do contexto descartado.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { command } from '#commands/command.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { definePlugin } from '#plugin/define.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { message, RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';

interface Contador {
  incrementa(): Promise<number>;
}

declare module '@zapforge/core' {
  interface Services {
    contador: Contador;
  }
}

const ENGINE = '>=0.0.0';
const bots: Bot[] = [];

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

function bot(config: Omit<BotConfig, 'env' | 'outbound'>): Bot {
  const created = createBot({
    env: {},
    // O setup quebrado de propósito loga erro: fica no logger de teste, fora da saída.
    logger: recordingLogger(),
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...config,
  });
  bots.push(created);
  return created;
}

/** Provedor com config `passo`; `quebrado: true` faz o `setup` falhar. */
const provedor = definePlugin({
  name: 'provedor',
  version: '1.0.0',
  engine: ENGINE,
  config: z.object({ passo: z.number().default(1), quebrado: z.boolean().default(false) }),
  setup(ctx) {
    if (ctx.config.quebrado) throw new Error('config quebrada');
    ctx.services.provide('contador', {
      async incrementa() {
        const atual = ((await ctx.storage.kv.get('n')) as number | undefined) ?? 0;
        await ctx.storage.kv.set('n', atual + ctx.config.passo);
        return atual + ctx.config.passo;
      },
    });
  },
});

/** Guarda o serviço no `setup`, como o plano §6.7 ensina. */
const dependente = definePlugin({
  name: 'dependente',
  version: '1.0.0',
  engine: ENGINE,
  dependsOn: { provedor: '^1.0.0' },
  setup(ctx) {
    const contador = ctx.services.get('contador');
    ctx.commands.add(
      command({ name: 'conta', run: async (c) => c.reply(String(await contador.incrementa())) }),
    );
  },
});

const statusOf = (b: Bot) =>
  Object.fromEntries(
    b
      .plugins()
      .map((entry) => [entry.name, entry.status === 'loaded' ? 'loaded' : entry.reason.kind]),
  );

describe('reload de plugin provedor (#226)', () => {
  it('dependente que guardou o serviço no setup usa a instância nova, com a config nova', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport, storage: createMemoryStorage(), plugins: [provedor, dependente] });
    await b.start();

    await b.config.setOverrides('provedor', { passo: 10 });
    transport.emit('message', message('!conta'));
    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['10']));
  });

  it('provedor que falha no setup novo deixa o dependente "dependency-skipped"; recuperado, ele volta', async () => {
    const transport = new RecordingTransport();
    const b = bot({ transport, storage: createMemoryStorage(), plugins: [provedor, dependente] });
    await b.start();

    const result = await b.config.setOverrides('provedor', { quebrado: true });
    expect(statusOf(b)).toEqual({ provedor: 'setup-failed', dependente: 'dependency-skipped' });
    expect(result?.dependents.map((entry) => entry.name)).toEqual(['dependente']);

    await b.config.setOverrides('provedor', { passo: 2 });
    expect(statusOf(b)).toEqual({ provedor: 'loaded', dependente: 'loaded' });
    transport.emit('message', message('!conta'));
    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['2']));
  });

  it('setup novo de um dependente que falha vira plugin.error', async () => {
    const errors: PluginErrorEvent[] = [];
    let quebra = false;
    const fragil = definePlugin({
      name: 'fragil',
      version: '1.0.0',
      engine: ENGINE,
      dependsOn: { provedor: '^1.0.0' },
      setup() {
        if (quebra) throw new Error('não subiu');
      },
    });
    const observador = definePlugin({
      name: 'observador',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('plugin.error', (e) => void errors.push(e.payload));
      },
    });
    const b = bot({
      transport: new RecordingTransport(),
      storage: createMemoryStorage(),
      plugins: [provedor, fragil, observador],
    });
    await b.start();

    quebra = true;
    await b.config.setOverrides('provedor', { passo: 3 });
    expect(statusOf(b)).toMatchObject({ provedor: 'loaded', fragil: 'setup-failed' });
    await vi.waitFor(() =>
      expect(errors.map((e) => `${e.plugin}:${e.phase}`)).toEqual(['fragil:setup']),
    );
  });
});
