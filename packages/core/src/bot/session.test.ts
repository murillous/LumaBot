// Aceite do M1-20 (#207, ADR 0036): bots de sessões diferentes dividem um storage sem dividir
// jobs, KV de plugin nem overrides; a mesma sessão não roda duas vezes no mesmo storage.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BotConfigError } from '#config/owners.ts';
import { definePlugin } from '#plugin/define.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { deferred, RecordingTransport, recordingLogger } from './harness.test-support.ts';

// Faixa aberta: os testes não quebram quando o changesets subir a versão do core.
const ENGINE = '>=0.0.0';

const bots: Bot[] = [];

function bot(config: Partial<BotConfig>): Bot {
  const created = createBot({
    transport: new RecordingTransport(),
    logger: recordingLogger(),
    env: {},
    ...config,
  });
  bots.push(created);
  return created;
}

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

describe('createBot({ session })', () => {
  it.each(['Vendas', 'meu numero', 'a:b', '$scheduler', ''])(
    'sessão inválida (%j) é BotConfigError',
    (session) => {
      expect(() => createBot({ transport: new RecordingTransport(), session })).toThrow(
        BotConfigError,
      );
    },
  );
});

describe('Bot: sessões diferentes no mesmo storage', () => {
  it('não compartilham jobs do scheduler', async () => {
    const storage = createMemoryStorage();
    const fired: string[] = [];
    const gate = deferred();
    const agenda = (session: string, agendar: boolean) =>
      definePlugin({
        name: 'agenda',
        version: '1.0.0',
        engine: ENGINE,
        async setup(ctx) {
          ctx.scheduler.on('lembrar', async () => {
            fired.push(session);
            await gate.promise;
          });
          if (agendar) await ctx.scheduler.at(0, 'lembrar');
        },
      });
    const vendas = bot({ session: 'vendas', storage, plugins: [agenda('vendas', true)] });
    const suporte = bot({ session: 'suporte', storage, plugins: [agenda('suporte', false)] });

    await vendas.start();
    await vi.waitFor(() => expect(fired).toEqual(['vendas']));
    // O job segue no storage enquanto o handler roda: no mesmo namespace, o scheduler do
    // suporte o acharia ao subir.
    await suporte.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    gate.resolve();

    expect(fired).toEqual(['vendas']);
  });

  it('não compartilham o KV dos plugins nem os overrides de config', async () => {
    const storage = createMemoryStorage();
    const kv = new Map<string, unknown>();
    const eco = (session: string) =>
      definePlugin({
        name: 'eco',
        version: '1.0.0',
        engine: ENGINE,
        config: z.object({ prefixo: z.string().default('eco') }),
        async setup(ctx) {
          if (session === 'vendas') await ctx.storage.kv.set('ultimo', 'vendas');
          kv.set(session, await ctx.storage.kv.get('ultimo'));
        },
      });
    const vendas = bot({ session: 'vendas', storage, plugins: [eco('vendas')] });
    const suporte = bot({ session: 'suporte', storage, plugins: [eco('suporte')] });
    await vendas.start();
    await suporte.start();

    expect(kv).toEqual(
      new Map([
        ['vendas', 'vendas'],
        ['suporte', undefined],
      ]),
    );
    await vendas.config.setOverrides('eco', { prefixo: 'novo' });
    await expect(vendas.config.describe('eco')).resolves.toMatchObject({
      config: { prefixo: 'novo' },
    });
    await expect(suporte.config.describe('eco')).resolves.toMatchObject({
      config: { prefixo: 'eco' },
    });
  });

  it('o storage só fecha quando o último bot que o usa para', async () => {
    const storage = createMemoryStorage();
    const close = vi.spyOn(storage, 'close');
    const vendas = bot({ session: 'vendas', storage });
    const suporte = bot({ session: 'suporte', storage });
    await vendas.start();
    await suporte.start();

    await vendas.stop();
    expect(close).not.toHaveBeenCalled();
    await suporte.stop();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('Bot: a mesma sessão duas vezes no mesmo storage', () => {
  it('o segundo start() rejeita sem derrubar o primeiro nem fechar o storage', async () => {
    const storage = createMemoryStorage();
    const close = vi.spyOn(storage, 'close');
    const first = bot({ storage });
    const second = bot({ storage, session: 'default' });
    await first.start();

    await expect(second.start()).rejects.toThrow(BotConfigError);
    expect(second.state).toBe('stopped');
    expect(first.state).toBe('running');
    expect(close).not.toHaveBeenCalled();
  });

  it('depois do stop() a sessão fica livre para outro bot', async () => {
    const storage = createMemoryStorage();
    // Outra sessão mantém o storage aberto depois que o primeiro bot para.
    await bot({ storage, session: 'suporte' }).start();
    const first = bot({ storage, session: 'vendas' });
    await first.start();
    await first.stop();

    await expect(bot({ storage, session: 'vendas' }).start()).resolves.toBeUndefined();
  });

  it('sessões iguais em storages diferentes não conflitam', async () => {
    await bot({ session: 'vendas' }).start();
    await expect(bot({ session: 'vendas' }).start()).resolves.toBeUndefined();
  });
});
