import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { type UserNamesService, userNames } from './user-names.ts';

let bot: TestBot;
let service: UserNamesService;

const probe = definePlugin({
  name: 'probe',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { 'user-names': '^1.0.0' },
  setup: (ctx) => {
    service = ctx.services.get('userNames');
  },
});

afterEach(async () => {
  await bot.stop();
});

const KEY = '5511999990001@s.whatsapp.net';
const lid = { id: '123@lid', name: 'Ana', phone: '5511999990001' };
const group = { id: 'g@fake', isGroup: true };

it('o nome visto no grupo (LID) resolve pela chave de telefone', async () => {
  bot = await createTestBot({ plugins: [userNames, probe] });

  await bot.receive({ text: 'oi', sender: lid, chat: group });

  expect(await service.displayName(KEY)).toBe('Ana');
  expect(await service.displayName('123@lid')).toBe('Ana');
});

it('o apelido dado no grupo (LID) vale também sob a chave de telefone', async () => {
  bot = await createTestBot({ plugins: [userNames, probe] });

  await bot.receive({ text: '!nick Aninha', sender: lid, chat: group });

  expect(await service.displayName(KEY)).toBe('Aninha');
  expect(await service.displayName('123@lid')).toBe('Aninha');
});
