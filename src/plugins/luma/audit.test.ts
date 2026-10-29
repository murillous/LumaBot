import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, scripted } from '#plugins/ai-testing.ts';
import { auditReader } from '#plugins/audit-reader.ts';
import { luma } from './luma.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const generated = JSON.stringify({
  name: 'Vovó Italiana',
  description: '👵 carinhosa',
  context: 'Você é uma vovó italiana super secreta.',
  style: 'sotaque carregado',
  traits: ['faz massa', 'chama de bambino', 'reclama'],
});

async function start() {
  const reader = auditReader();
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: scripted(generated) }), luma, reader.plugin],
    adminPlugins: [reader.plugin.name],
    pluginConfig: {
      ai: { models: [{ model: 'fake:a' }] },
      luma: { thinkingDelayMs: { min: 0, max: 0 } },
    },
  });
  return { b: bot, reader };
}

it('luma.persona.set audita a troca, com o chat como alvo', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!persona 2', chat: { id: 'grupo@fake', isGroup: true } });

  const [event] = await reader.events('luma.persona.set');
  expect(event?.target).toEqual({ type: 'chat', id: 'grupo@fake' });
  expect(event?.details).toEqual({ key: 'agressiva' });
});

it('em conversa privada o alvo é o chat pseudonimizado, sem o número cru', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!persona 2', chat: 'privado@fake' });

  const [event] = await reader.events('luma.persona.set');
  expect(event?.target?.id).toMatch(/^u_/);
  expect(JSON.stringify(event)).not.toContain('privado@fake');
});

it('luma.persona.create e .delete não levam o texto da persona', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!persona criar uma vovó italiana' });
  await b.receive({ text: '!persona deletar 6' });

  const [created] = await reader.events('luma.persona.create');
  const [deleted] = await reader.events('luma.persona.delete');
  expect(created?.target?.type).toBe('chat');
  expect(deleted?.target?.type).toBe('chat');
  expect(JSON.stringify([created, deleted])).not.toContain('super secreta');
});

it('luma.history.clear registra o contato que pediu', async () => {
  const { b, reader } = await start();
  await b.receive({ text: '!luma clear', sender: { id: 'titular@fake' } });

  const [event] = await reader.events('luma.history.clear');
  expect(event?.details?.['contact']).toEqual(expect.stringMatching(/^u_/));
  expect(JSON.stringify(event)).not.toContain('titular@fake');
  expect(event?.target?.id).toMatch(/^u_/);
  expect(JSON.stringify(event)).not.toContain('chat@fake');
});
