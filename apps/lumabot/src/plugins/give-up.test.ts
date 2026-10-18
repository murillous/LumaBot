import type { DisconnectReason } from '@usebridger/core';
import { createTestBot } from '@usebridger/testing';
import { expect, it } from 'vitest';
import { giveUp } from './give-up.ts';

it('avisa o app só nos motivos em que a reconexão desiste', async () => {
  const reasons: DisconnectReason[] = [];
  const bot = await createTestBot({ plugins: [giveUp((reason) => reasons.push(reason))] });

  for (const reason of [
    'connection-lost',
    'logged-out',
    'auth-failed',
    'fatal',
    'replaced',
  ] as const) {
    await bot.emit('connection.status', { status: 'closed', reason, error: undefined });
  }
  await bot.emit('connection.status', { status: 'open' });

  expect(reasons).toEqual(['fatal', 'replaced']);
  await bot.stop();
});
