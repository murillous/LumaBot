import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { personId } from '#plugins/person-id.ts';
import { type RankService, rank } from './rank.ts';

let bot: TestBot;
let service: RankService;

const probe = definePlugin({
  name: 'probe',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { rank: '^1.0.0' },
  setup: (ctx) => {
    service = ctx.services.get('rank');
  },
});

afterEach(async () => {
  await bot.stop();
});

const KEY = '5511999990001@s.whatsapp.net';

it('a mesma pessoa, LID no grupo e telefone no privado, vira uma linha no global', async () => {
  bot = await createTestBot({ plugins: [rank, probe] });
  await service.record('g1', personId({ id: '123@lid', phone: '5511999990001' }));
  await service.record('priv', personId({ id: KEY, phone: '5511999990001' }));
  // Sem telefone conhecido o contato continua contando, pelo id.
  await service.record('g1', personId({ id: 'sem@lid', phone: null }));

  expect(await service.top('global', 10)).toEqual([
    { id: KEY, count: 2 },
    { id: 'sem@lid', count: 1 },
  ]);
});
