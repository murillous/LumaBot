// O `user-names` dá ao `ai-context` o nome de quem fala, pelo ponto `ai-context.names`.

import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted } from '#plugins/ai/testing.ts';
import { aiContext } from '#plugins/ai-context/ai-context.ts';
import { eco } from '#plugins/ai-context/testing.ts';
import { userNames } from './user-names.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

it('o apelido do !nick é o nome que a IA lê na transcrição', async () => {
  const model = scripted('oi, Aninha');
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: model }), aiContext, eco, userNames],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
  });
  const ana = { id: 'ana@fake', name: 'Ana Paula' };
  await bot.receive({ text: '!nick Aninha', sender: ana });

  await bot.receive({ text: 'eco, oi', sender: ana });

  expect(promptText(model)).toMatch(/Aninha: eco, oi/);
});
