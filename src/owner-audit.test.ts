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

  const events = await reader.events('command.owner', 2);
  expect(events.map((e) => e.outcome).sort()).toEqual(['denied', 'success']);
  expect(JSON.stringify(events)).not.toContain('senha123');
  expect(events.map((e) => e.details?.['status']).sort()).toEqual(['ran', 'rejected']);
  expect(events[0]?.details).toMatchObject({ plugin: 'admin', command: 'secreto' });
  expect(JSON.stringify(events)).not.toContain('dono@fake');
  expect(JSON.stringify(events)).not.toContain('chat@fake');
  expect(events[0]?.target?.id).toMatch(/^u_/);
  await bot.stop();
});

it('em grupo o alvo mantém o id cru do chat', async () => {
  const reader = auditReader();
  const bot = await createTestBot({
    plugins: [ownerAudit, admin, reader.plugin],
    adminPlugins: [reader.plugin.name],
    owners: [{ id: 'dono@fake' }],
  });
  await bot.receive({
    text: '!secreto',
    chat: { id: 'grupo@fake', isGroup: true },
    sender: { id: 'dono@fake' },
  });

  const [event] = await reader.events('command.owner');
  expect(event?.target).toEqual({ type: 'chat', id: 'grupo@fake' });
  await bot.stop();
});
