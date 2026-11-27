import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { help } from '#plugins/help/help.ts';
import { ping } from '#plugins/ping.ts';
import { welcome } from './welcome.ts';

let bot: TestBot;

afterEach(async () => {
  await bot.stop();
});

const texts = () => bot.sent.flatMap((s) => (s.content.type === 'text' ? [s.content.text] : []));

it('primeira mensagem no privado recebe a apresentação com o menu', async () => {
  bot = await createTestBot({ plugins: [help, ping, welcome] });

  await bot.receive({ text: 'oi' });

  expect(texts()).toHaveLength(1);
  const [text] = texts();
  expect(text).toContain('Eu sou a *Luma*');
  expect(text).toContain('*!menu*');
  expect(text).toContain('Comandos da Luma');
  expect(text).toContain('*!ping*');
});

it('apresenta uma vez só por pessoa', async () => {
  bot = await createTestBot({ plugins: [help, welcome] });

  await bot.receive({ text: 'oi' });
  await bot.receive({ text: 'tudo bem?' });

  expect(texts()).toHaveLength(1);
});

it('a mesma pessoa por LID e por número é apresentada uma vez', async () => {
  bot = await createTestBot({ plugins: [help, welcome] });

  await bot.receive({ text: 'oi', sender: { id: '123@lid', phone: '5511999' } });
  await bot.receive({ text: 'oi', sender: { id: '5511999@s.whatsapp.net', phone: '5511999' } });

  expect(texts()).toHaveLength(1);
});

it('pessoas diferentes recebem cada uma a sua', async () => {
  bot = await createTestBot({ plugins: [help, welcome] });

  await bot.receive({ text: 'oi', chat: 'a@fake', sender: { id: 'a@fake', phone: '111' } });
  await bot.receive({ text: 'oi', chat: 'b@fake', sender: { id: 'b@fake', phone: '222' } });

  expect(texts()).toHaveLength(2);
});

it('não apresenta em grupo', async () => {
  bot = await createTestBot({ plugins: [help, welcome] });

  await bot.receive({ text: 'oi', chat: { id: 'grupo@fake', isGroup: true } });

  expect(bot.sent).toHaveLength(0);
});

it('quem começa por um comando não recebe a apresentação depois', async () => {
  bot = await createTestBot({ plugins: [help, ping, welcome] });

  await bot.receive({ text: '!ping' });
  await bot.receive({ text: 'oi' });

  expect(texts()).toEqual(['pong']);
});

it('mensagem de outro bot não conta', async () => {
  bot = await createTestBot({ plugins: [help, welcome] });

  await bot.receive({ text: 'oi', sender: { isBot: true } });
  await bot.receive({ text: 'oi' });

  expect(texts()).toHaveLength(1);
});

it('ao ser adicionada num grupo, se apresenta com o menu do grupo', async () => {
  const admin = definePlugin({
    name: 'admin',
    version: '1.0.0',
    engine: '<1.0.0',
    commands: { kick: { description: 'remove', role: 'group-admin', run: () => 'x' } },
  });
  bot = await createTestBot({ plugins: [help, ping, admin, welcome] });
  const group = { id: 'grupo@fake', isGroup: true };

  bot.transport.emit('group.joined', { chat: group });
  await vi.waitFor(() => expect(bot.sent).toHaveLength(1));

  const [sent] = bot.sent;
  expect(sent?.chatId).toBe('grupo@fake');
  const [text] = texts();
  expect(text).toContain('Oi, gente! Eu sou a *Luma*');
  expect(text).toContain('*!menu*');
  expect(text).toContain('*!ping*');
  expect(text).toContain('*!kick*');
});

it('mensagens no grupo depois da entrada não repetem a apresentação', async () => {
  bot = await createTestBot({ plugins: [help, welcome] });
  const group = { id: 'grupo@fake', isGroup: true };

  bot.transport.emit('group.joined', { chat: group });
  await vi.waitFor(() => expect(bot.sent).toHaveLength(1));
  await bot.receive({ text: 'oi', chat: group });

  expect(bot.sent).toHaveLength(1);
});
