import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { auditReader } from '#plugins/audit-reader.ts';
import { reminders } from './reminders.ts';

let bot: TestBot | undefined;

// Só o `Date` é falso: o dreno da auditoria usa timers reais.
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-16T12:00:00Z'), toFake: ['Date'] });
});
afterEach(async () => {
  await bot?.stop();
  vi.useRealTimers();
});

async function start() {
  const reader = auditReader();
  bot = await createTestBot({
    plugins: [reminders, aiToolsProbe, reader.plugin],
    adminPlugins: [reader.plugin.name],
  });
  await bot.receive({ text: '!lembrete 16/10 15:00 reunião', sender: { id: 'dona@fake' } });
  return { b: bot, reader };
}

it('reminders.delete audita quando quem cancela não é o dono, com pseudônimos', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!cancelarlembrete 1', sender: { id: 'outro@fake' } });

  const [event] = await reader.events('reminders.delete');
  expect(event?.details?.['actor']).toEqual(expect.stringMatching(/^u_/));
  expect(event?.details?.['creator']).toEqual(expect.stringMatching(/^u_/));
  expect(event?.details?.['actor']).not.toBe(event?.details?.['creator']);
  expect(JSON.stringify(event)).not.toMatch(/dona@|outro@|reunião/);
});

it('a tool cancel_reminder também audita o cancelamento por terceiro', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!tool list_reminders', sender: { id: 'outro@fake' } });
  const id = (toolResult(b) as { reminders: { id: string }[] }).reminders[0]?.id;
  await b.receive({ text: `!tool cancel_reminder {"id":"${id}"}`, sender: { id: 'outro@fake' } });

  expect(await reader.events('reminders.delete')).toHaveLength(1);
});

it('o dono cancelando o próprio lembrete não é auditado', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!lembrete 16/10 16:00 segundo', sender: { id: 'dona@fake' } });
  await b.receive({ text: '!cancelarlembrete 1', sender: { id: 'dona@fake' } });
  // Sentinela positiva: o cancelamento por terceiro vem depois, então a ausência do anterior
  // fica provada quando só este aparece.
  await b.receive({ text: '!cancelarlembrete 1', sender: { id: 'outro@fake' } });

  expect(await reader.events('reminders.delete')).toHaveLength(1);
});
