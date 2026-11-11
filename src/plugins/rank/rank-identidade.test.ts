import { createMemoryStorage, definePlugin } from '@usebridger/core';
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

it('zera o histórico antigo uma vez e não zera de novo nos boots seguintes', async () => {
  const storage = createMemoryStorage();
  // `stop` fecha o storage; aqui ele precisa sobreviver entre os boots, como um banco em disco.
  const close = storage.close.bind(storage);
  storage.close = () => Promise.resolve();
  const boot = async () => {
    bot = await createTestBot({ plugins: [rank, probe], storage });
  };
  const kv = storage.forNamespace('rank').kv;

  // Histórico da chave antiga: a marca é apagada para simular o estado de antes da troca.
  await boot();
  await service.record('g1', 'antigo@lid');
  await bot.stop();
  await kv.delete('identityV2');

  await boot();
  expect(await service.top('global', 10)).toEqual([]);
  expect(await kv.get('identityV2')).toBe(true);

  await service.record('g1', KEY);
  await bot.stop();

  await boot();
  expect(await service.top('global', 10)).toEqual([{ id: KEY, count: 1 }]);
  await close();
});
