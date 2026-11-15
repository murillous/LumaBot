import { definePlugin, type Logger, type ServiceAccess } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { actionTracker } from '#plugins/action-metrics.ts';
import { type UsageEntry, type UsageService, usage } from './usage.ts';
import { usageProbe } from './usage-testing.ts';

let bot: TestBot | undefined;
let services: ServiceAccess;
let log: Logger;

// Pega o `services` e o `log` de um plugin, como o `track` os recebe.
const capture = definePlugin({
  name: 'capture',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { usage: '*' },
  setup: (ctx) => {
    services = ctx.services;
    log = ctx.log;
  },
});

afterEach(async () => {
  await bot?.stop();
  bot = undefined;
  vi.useRealTimers();
});

async function start(config: Record<string, unknown> = {}) {
  const probe = usageProbe();
  bot = await createTestBot({
    plugins: [usage, probe.plugin, capture],
    pluginConfig: { usage: config },
  });
  return { service: services.get('usage') as UsageService, entries: probe.entries };
}

const entry = (over: Partial<UsageEntry> = {}): UsageEntry => ({
  actor: '5511999@s.whatsapp.net',
  chatId: 'grupo@g.us',
  action: 'sticker',
  kind: 'media',
  outcome: 'ok',
  ...over,
});

it('agrega por dia, chat, ação, variante e resultado, somando o custo informado', async () => {
  const { service } = await start();
  await service.record(entry());
  await service.record(entry({ cost: 0.25 }));
  await service.record(entry({ outcome: 'error' }));
  await service.record(entry({ actor: 'outro@s.whatsapp.net' }));

  const rows = await service.history('5511999@s.whatsapp.net');

  expect(rows).toHaveLength(2);
  expect(rows).toContainEqual(expect.objectContaining({ outcome: 'ok', count: 2, cost: 0.25 }));
  expect(rows).toContainEqual(expect.objectContaining({ outcome: 'error', count: 1, cost: 0 }));
});

it('o histórico só traz os dias pedidos, e o registro apaga o que passou da retenção', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  const { service } = await start({ retentionDays: 3 });
  await service.record(entry());

  vi.setSystemTime(new Date('2026-01-03T12:00:00Z'));
  await service.record(entry());
  expect(await service.history(entry().actor, { days: 1 })).toHaveLength(1);
  expect(await service.history(entry().actor, { days: 3 })).toHaveLength(2);

  vi.setSystemTime(new Date('2026-01-04T12:00:00Z'));
  await service.record(entry());
  // 01/01 saiu: a retenção de 3 dias guarda 02, 03 e 04.
  expect((await service.history(entry().actor, { days: 10 })).map((r) => r.day)).toEqual([
    '2026-01-04',
    '2026-01-03',
  ]);
});

it('entrega cada registro aos observers', async () => {
  const { service, entries } = await start();
  await service.record(entry({ cost: 0.1 }));

  expect(entries).toEqual([entry({ cost: 0.1 })]);
});

it('um observer quebrado não derruba o registro nem os outros observers', async () => {
  const broken = definePlugin({
    name: 'broken',
    version: '0.0.0',
    engine: '<1.0.0',
    setup: (ctx) => {
      ctx.services.contribute('usage.observers', () => {
        throw new Error('quebrou');
      });
    },
  });
  const probe = usageProbe();
  bot = await createTestBot({ plugins: [usage, broken, probe.plugin, capture] });

  await services.get('usage').record(entry());

  expect(probe.entries).toEqual([entry()]);
  expect(await services.get('usage').history(entry().actor)).toHaveLength(1);
});

it('o track registra o uso de quem pediu, pelo personId, com o resultado', async () => {
  const { entries } = await start();
  const track = actionTracker(
    {
      metric: 'sticker',
      help: 'Figurinhas',
      buckets: [1],
      events: {
        done: { name: 'x.done', level: 'info', message: 'ok' },
        refused: { name: 'x.refused', level: 'warn', message: 'recusa' },
        failed: { name: 'x.failed', level: 'error', message: 'falha' },
      },
    },
    undefined,
    services,
  );
  const message = {
    sender: { id: '123@lid', name: 'Ana', phone: '5511999' },
    chat: { id: 'grupo@g.us', isGroup: true },
  };

  await track({ log, message }, 'media', async () => undefined);
  await track({ log, message }, 'media', async (step) => step.refuse('grande'));
  await expect(
    track({ log, message }, 'media', async () => {
      throw new Error('quebrou');
    }),
  ).rejects.toThrow('quebrou');
  // Sem mensagem (ação que não foi a pedido de alguém), não registra.
  await track({ log }, 'media', async () => undefined);

  expect(entries.map((e) => [e.actor, e.chatId, e.action, e.kind, e.outcome])).toEqual([
    ['5511999@s.whatsapp.net', 'grupo@g.us', 'sticker', 'media', 'ok'],
    ['5511999@s.whatsapp.net', 'grupo@g.us', 'sticker', 'media', 'refused'],
    ['5511999@s.whatsapp.net', 'grupo@g.us', 'sticker', 'media', 'error'],
  ]);
});
