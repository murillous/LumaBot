import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { type AiProvider, ai } from '#plugins/ai/ai.ts';
import { aiAnthropic } from './ai-anthropic.ts';

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
    plugins: [ai, aiAnthropic, spy('ai-anthropic')],
    ...(key && { pluginConfig: { 'ai-anthropic': { key } } }),
  });
  return listed[0];
}

it('com chave: só texto, sem temperature (os Claude 5.5 a recusam)', async () => {
  const anthropic = await start('a-key');

  expect(anthropic).toMatchObject({ name: 'anthropic', temperature: null });
  expect(anthropic?.languageModel('claude-haiku-5-5')).toMatchObject({
    modelId: 'claude-haiku-5-5',
  });
  expect(anthropic?.imageModel).toBeUndefined();
  expect(anthropic?.nativeSearch).toBeUndefined();
});
