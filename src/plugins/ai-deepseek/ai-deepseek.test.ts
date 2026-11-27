import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { type AiProvider, ai } from '#plugins/ai/ai.ts';
import { aiDeepseek } from './ai-deepseek.ts';

let bot: TestBot;

afterEach(async () => {
  await bot.stop();
});

let listed: AiProvider[] = [];
/** Lê o ponto `ai.providers` depois que o provider subiu. */
const spy = (plugin: string) =>
  definePlugin({
    name: 'spy',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0', [plugin]: '^0.1.0' },
    setup: (ctx) => {
      listed = [...ctx.services.extensionPoint('ai.providers').list()];
    },
  });

async function start(key?: string) {
  bot = await createTestBot({
    plugins: [ai, aiDeepseek, spy('ai-deepseek')],
    ...(key && { pluginConfig: { 'ai-deepseek': { key } } }),
  });
  return listed[0];
}

it('um bot só com o ai-deepseek sobe com o provider deepseek', async () => {
  const deepseek = await start('d-key');

  expect(listed.map((p) => p.name)).toEqual(['deepseek']);
  expect(deepseek?.languageModel('deepseek-flash')).toMatchObject({ modelId: 'deepseek-flash' });
  expect(deepseek?.imageModel).toBeUndefined();
});
