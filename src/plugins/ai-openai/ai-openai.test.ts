import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { type AiProvider, ai } from '#plugins/ai/ai.ts';
import { aiOpenai } from './ai-openai.ts';

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
    plugins: [ai, aiOpenai, spy('ai-openai')],
    ...(key && { pluginConfig: { 'ai-openai': { key } } }),
  });
  return listed[0];
}

it('com chave: texto e imagem, sem busca nativa', async () => {
  const openai = await start('o-key');

  expect(openai).toMatchObject({ name: 'openai', key: { configured: true } });
  expect(openai?.languageModel('gpt-5')).toMatchObject({ modelId: 'gpt-5' });
  expect(openai?.imageModel).toBeTypeOf('function');
  expect(openai?.nativeSearch).toBeUndefined();
});
