import { createTestBot } from '@usebridger/testing';
import { expect, it } from 'vitest';
import { auditReader } from './audit-reader.ts';
import { pairing } from './pairing.ts';

async function start() {
  const reader = auditReader();
  const bot = await createTestBot({
    plugins: [pairing(() => undefined), reader.plugin],
    adminPlugins: [reader.plugin.name],
  });
  return { bot, reader };
}

it.each([
  ['connection.qr', { qr: '2@abc' }],
  ['connection.pairing-code', { code: 'ABCD1234' }],
] as const)(
  'pairing.session.paired audita a conexão que veio depois de %s',
  async (event, payload) => {
    const { bot, reader } = await start();
    await bot.emit(event, payload);
    await bot.emit('connection.status', { status: 'open' });

    expect(await reader.events('pairing.session.paired')).toHaveLength(1);
    await bot.stop();
  },
);

it('reconexão comum, sem QR antes, não é novo pareamento', async () => {
  const { bot, reader } = await start();
  await bot.emit('connection.status', { status: 'open' });
  // Sentinela positiva: o `lost` vem depois do `open`, então se ele já foi gravado o `paired`
  // indevido também seria.
  await bot.emit('connection.status', { status: 'closed', reason: 'logged-out', error: null });
  await reader.events('pairing.session.lost');

  expect(await reader.events('pairing.session.paired', 0)).toHaveLength(0);
  await bot.stop();
});

it.each(['logged-out', 'auth-failed'] as const)(
  'pairing.session.lost audita a sessão perdida (%s)',
  async (reason) => {
    const { bot, reader } = await start();
    await bot.emit('connection.status', { status: 'closed', reason, error: null });

    const [event] = await reader.events('pairing.session.lost');
    expect(event?.details).toEqual({ reason });
    await bot.stop();
  },
);
