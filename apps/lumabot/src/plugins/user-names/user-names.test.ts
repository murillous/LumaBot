import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { type UserNamesService, userNames } from './user-names.ts';

let bot: TestBot;
let service: UserNamesService;

/** Plugin de teste que só dependsOn o dono: entrega o serviço, como faria o `rank`. */
const probe = definePlugin({
  name: 'probe',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { 'user-names': '^1.0.0' },
  setup: (ctx) => {
    service = ctx.services.get('userNames');
  },
});

async function start(...extra: PluginDefinition[]): Promise<void> {
  bot = await createTestBot({ plugins: [userNames, probe, ...extra] });
}

afterEach(async () => {
  await bot.stop();
});

function names(): UserNamesService {
  return service;
}

it('!nick define o próprio apelido e o displayName passa a usá-lo', async () => {
  await start();

  await bot.receive({ text: '!nick Zé da Luma', sender: { id: 'a@fake', name: 'Ana' } });

  expect(bot.sent).toHaveReplied('✅ Apelido definido: *Zé da Luma*');
  expect(await names().nick('a@fake')).toBe('Zé da Luma');
  expect(await names().displayName('a@fake')).toBe('Zé da Luma');
});

it('!apelido @pessoa Nome define o de quem foi mencionado', async () => {
  await start();

  await bot.receive({
    text: '!apelido @5511 Chefe',
    mentions: [{ id: 'b@fake', name: 'Bia', phone: '5511', tag: '@5511' }],
  });

  expect(await names().nick('b@fake')).toBe('Chefe');
  expect(await names().nick('user@fake')).toBeNull();
  expect(bot.sent).toHaveReplied('✅ Apelido de Bia definido: *Chefe*');
});

it('sem nome, ou @ sem menção resolvida, responde o uso', async () => {
  await start();

  await bot.receive({ text: '!nick' });
  await bot.receive({ text: '!nick @alguem Fulano' });

  expect(bot.sent).toHaveReplied('ℹ️ Uso: *!nick SeuNome* ou *!nick @pessoa Nome*');
  expect(await names().nick('user@fake')).toBeNull();
});

it('lembra o nome do remetente (mesmo em comando) e do mencionado', async () => {
  await start();

  await bot.receive({ text: 'oi', sender: { id: 'a@fake', name: 'Ana' } });
  await bot.receive({
    text: '!ping',
    sender: { id: 'c@fake', name: 'Caio' },
    mentions: [{ id: 'd@fake', name: 'Duda', phone: null }],
  });

  expect(await names().displayName('a@fake')).toBe('Ana');
  expect(await names().displayName('c@fake')).toBe('Caio');
  expect(await names().displayName('d@fake')).toBe('Duda');
});

it('lembra participantes de grupo e contact.updated; nome vazio não apaga', async () => {
  await start();

  await bot.emit('group.participants', {
    chat: { id: 'g@fake', isGroup: true },
    action: 'add',
    participants: [{ id: 'e@fake', name: 'Eva', phone: null }],
    actor: null,
  } as never);
  await bot.emit('contact.updated', { id: 'e@fake', name: null, phone: '5599' });

  expect(await names().displayName('e@fake')).toBe('Eva');
});

it('o apelido vence o nome observado', async () => {
  await start();
  await names().remember({ id: 'a@fake', name: 'Ana', phone: null });
  await names().setNick('a@fake', 'Aninha');

  expect(await names().displayName('a@fake')).toBe('Aninha');
});

it('sem fonte, cai no telefone ou no id sem expor o LID', async () => {
  await start();
  await names().remember({ id: 'x@s.whatsapp.net', name: null, phone: '5511999' });

  expect(await names().displayName('x@s.whatsapp.net')).toBe('5511999');
  expect(await names().displayName('5522@s.whatsapp.net')).toBe('5522');
  expect(await names().displayName('123456789@lid')).toBe('usuário');
});

it('plugin que só contribui uma fonte muda o displayName sem tocar no dono', async () => {
  const crm = definePlugin({
    name: 'crm',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { 'user-names': '^1.0.0' },
    setup: (ctx) => {
      ctx.services.contribute('userNames.sources', async (id) =>
        id === 'vip@fake' ? 'Cliente VIP' : null,
      );
    },
  });
  await start(crm);

  expect(await names().displayName('vip@fake')).toBe('Cliente VIP');
  expect(await names().displayName('outro@fake')).toBe('outro');
  // A fonte do `crm` vem depois das do dono: apelido e nome observado ainda vencem.
  await names().setNick('vip@fake', 'Chefe');
  expect(await names().displayName('vip@fake')).toBe('Chefe');
});
