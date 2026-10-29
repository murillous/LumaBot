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

it('pairing.session.paired audita a conexão que veio depois do QR', async () => {
  const { bot, reader } = await start();
  await bot.emit('connection.qr', { qr: '2@abc' });
  await bot.emit('connection.status', { status: 'open' });

  expect(await reader.events('pairing.session.paired')).toHaveLength(1);
  await bot.stop();
});

it('reconexão comum, sem QR antes, não é novo pareamento', async () => {
  const { bot, reader } = await start();
  await bot.emit('connection.status', { status: 'open' });

  expect(await reader.events('pairing.session.paired', 1)).toHaveLength(0);
  await bot.stop();
});

it('pairing.session.lost audita a sessão perdida, com o motivo', async () => {
  const { bot, reader } = await start();
  await bot.emit('connection.status', { status: 'closed', reason: 'logged-out', error: null });

  const [event] = await reader.events('pairing.session.lost');
  expect(event?.details).toEqual({ reason: 'logged-out' });
  await bot.stop();
});
