import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { userNames } from '#plugins/user-names/user-names.ts';
import { type RankService, rank } from './rank.ts';

let bot: TestBot;
let service: RankService;

/** Entrega o serviço, como faria o `ai`. */
const probe = definePlugin({
  name: 'probe',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { rank: '^1.0.0' },
  setup: (ctx) => {
    service = ctx.services.get('rank');
  },
});

async function start(...extra: PluginDefinition[]): Promise<void> {
  bot = await createTestBot({ plugins: [rank, probe, ...extra] });
}

afterEach(async () => {
  await bot.stop();
});

const group = { id: 'g1@fake', isGroup: true };

it('record soma por chat e no total; top ordena do maior para o menor', async () => {
  await start();
  await service.record('g1', 'a');
  await service.record('g1', 'b');
  await service.record('g1', 'b');
  await service.record('g2', 'a');
  await service.record('g2', 'a');

  expect(await service.top({ chatId: 'g1' }, 10)).toEqual([
    { id: 'b', count: 2 },
    { id: 'a', count: 1 },
  ]);
  expect(await service.top('global', 1)).toEqual([{ id: 'a', count: 3 }]);
});

it('!rank no grupo lista o ranking do grupo, com medalhas e fallback de nome', async () => {
  await start();
  await service.record('g1@fake', '5511999990001@s.whatsapp.net');
  await service.record('g1@fake', '5511999990002@s.whatsapp.net');
  await service.record('g1@fake', '5511999990002@s.whatsapp.net');
  await service.record('outro', '5511999990003@s.whatsapp.net');

  await bot.receive({ text: '!rank', chat: group });

  expect(bot.sent).toContainText(
    '🏆 *Ranking do Grupo* — quem mais fala comigo\n\n🥇 @990002 — 2\n🥈 @990001 — 1',
  );
});

it('!rank global e conversa privada usam o total', async () => {
  await start();
  await service.record('g1@fake', '5511999990001@s.whatsapp.net');
  await service.record('g2@fake', '5511999990001@s.whatsapp.net');

  await bot.receive({ text: '!rank global', chat: group });
  await bot.receive({ text: '!rank' });

  expect(bot.sent).toHaveLength(2);
  expect(bot.sent[0]?.quoted).toBeFalsy(); // como o sendText do legacy: sem citar
  expect(bot.sent).toContainText('🏆 *Ranking Global* — quem mais fala comigo\n\n🥇 @990001 — 2');
});

it('sem dados, responde que ninguém interagiu', async () => {
  await start();

  await bot.receive({ text: '!rank', chat: group });

  expect(bot.sent).toHaveReplied('🤷 Ninguém interagiu comigo ainda por aqui.');
});

it('com user-names, usa o nome de exibição (apelido)', async () => {
  await start(userNames);
  await bot.receive({ text: '!nick Zé', sender: { id: 'a@fake', name: 'Ana' } });
  await service.record('g1@fake', 'a@fake');

  await bot.receive({ text: '!rank', chat: group });

  expect(bot.sent).toContainText('🏆 *Ranking do Grupo* — quem mais fala comigo\n\n🥇 Zé — 1');
});

it('record simultâneo não duplica linha nem perde contagem', async () => {
  await start();

  await Promise.all([
    service.record('g1', 'a'),
    service.record('g2', 'a'),
    service.record('g1', 'a'),
  ]);

  expect(await service.top('global', 10)).toEqual([{ id: 'a', count: 3 }]);
  expect(await service.top({ chatId: 'g1' }, 10)).toEqual([{ id: 'a', count: 2 }]);
  expect(await service.top({ chatId: 'g2' }, 10)).toEqual([{ id: 'a', count: 1 }]);
});
