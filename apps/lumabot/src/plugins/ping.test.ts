import { createTestBot } from '@zapforge/testing';
import { expect, it } from 'vitest';
import { ping } from './ping.ts';

it('!ping responde pong citando a mensagem', async () => {
  const bot = await createTestBot({ plugins: [ping] });

  await bot.receive({ text: '!ping' });

  expect(bot.sent).toHaveReplied('pong');
  await bot.stop();
});

it('texto sem o comando não recebe resposta', async () => {
  const bot = await createTestBot({ plugins: [ping] });

  await bot.receive({ text: 'ping' });

  expect(bot.sent).toHaveLength(0);
  await bot.stop();
});
