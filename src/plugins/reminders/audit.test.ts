import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
    plugins: [reminders, reader.plugin],
    adminPlugins: [reader.plugin.name],
  });
  await bot.receive({ text: '!lembrete 16/10 15:00 reunião', sender: { id: 'dona@fake' } });
  return { b: bot, reader };
}

it('reminders.delete audita quando quem cancela não é o dono', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!cancelarlembrete 1', sender: { id: 'outro@fake' } });

  const [event] = await reader.events('reminders.delete');
  expect(event?.details).toMatchObject({ actor: 'outro@fake', creator: 'dona@fake' });
  expect(JSON.stringify(event)).not.toContain('reunião');
});

it('o dono cancelando o próprio lembrete não é auditado', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!cancelarlembrete 1', sender: { id: 'dona@fake' } });

  expect(await reader.events('reminders.delete', 1)).toHaveLength(0);
});
