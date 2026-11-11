import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { personId, type RankService, rank } from './rank.ts';

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

const start = async () => {
  bot = await createTestBot({ plugins: [rank, probe] });
};

afterEach(async () => {
  await bot?.stop();
});

const KEY = '5511999990001@s.whatsapp.net';

it('personId usa o telefone quando conhecido e o id cru quando não', () => {
  expect(personId({ id: '123@lid', phone: '5511999990001' })).toBe(KEY);
  expect(personId({ id: '123@lid', phone: null })).toBe('123@lid');
});

it('a mesma pessoa, LID no grupo e telefone no privado, vira uma linha no global', async () => {
  await start();
  const lid = { id: '123@lid', phone: '5511999990001' };
  const priv = { id: KEY, phone: '5511999990001' };
  await service.record('g1', personId(lid), lid.id);
  await service.record('priv', personId(priv), priv.id);
  // Sem telefone conhecido o contato continua contando, pelo id.
  await service.record('g1', personId({ id: 'sem@lid', phone: null }), 'sem@lid');

  expect(await service.top('global', 10)).toEqual([
    { id: KEY, count: 2 },
    { id: 'sem@lid', count: 1 },
  ]);
});

it('migra o histórico do id cru somando duplicados, e é idempotente', async () => {
  await start();
  await service.record('g1', '123@lid');
  await service.record('g1', '123@lid');
  await service.record('g2', '123@lid');
  await service.record('g1', KEY);
  await service.record('outro', '999@lid');

  await service.record('g1', KEY, '123@lid');
  await service.record('g1', KEY, '123@lid');

  expect(await service.top({ chatId: 'g1' }, 10)).toEqual([{ id: KEY, count: 5 }]);
  expect(await service.top({ chatId: 'g2' }, 10)).toEqual([{ id: KEY, count: 1 }]);
  expect(await service.top('global', 10)).toEqual([
    { id: KEY, count: 6 },
    { id: '999@lid', count: 1 },
  ]);
});
