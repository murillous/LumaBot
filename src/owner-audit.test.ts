import { definePlugin } from '@usebridger/core';
import { createTestBot } from '@usebridger/testing';
import { expect, it } from 'vitest';
import { auditReader } from '#plugins/audit-reader.ts';
import { ownerAudit } from './owner-audit.ts';

const admin = definePlugin({
  name: 'admin',
  version: '0.0.0',
  engine: '<1.0.0',
  commands: {
    secreto: { role: 'owner', run: () => 'ok' },
    aberto: { run: () => 'ok' },
  },
});

it('registra command.owner só para comando de owner, sem os argumentos', async () => {
  const reader = auditReader();
  const bot = await createTestBot({
    plugins: [ownerAudit, admin, reader.plugin],
    adminPlugins: [reader.plugin.name],
    owners: [{ id: 'dono@fake' }],
  });
  await bot.receive({ text: '!aberto' });
  await bot.receive({ text: '!secreto senha123', sender: { id: 'dono@fake' } });
  await bot.receive({ text: '!secreto x' });

  const events = await reader.events('command.owner');
  expect(events.map((e) => e.outcome).sort()).toEqual(['denied', 'success']);
  expect(JSON.stringify(events)).not.toContain('senha123');
  expect(events[0]?.details).toMatchObject({ plugin: 'admin', command: 'secreto' });
  await bot.stop();
});
