import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { type AiProvider, ai } from '#plugins/ai/ai.ts';
import { aiGoogle } from './ai-google.ts';

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
    plugins: [ai, aiGoogle, spy('ai-google')],
    ...(key && { pluginConfig: { 'ai-google': { key } } }),
  });
  return listed[0];
}

it('com chave: texto, imagem e a busca nativa do Gemini', async () => {
  const google = await start('g-key');

  expect(google).toMatchObject({ name: 'google', key: { configured: true } });
  expect(google?.languageModel('gemini-2.5-flash')).toMatchObject({ modelId: 'gemini-2.5-flash' });
  expect(google?.imageModel).toBeTypeOf('function');
  expect(Object.keys(google?.nativeSearch?.() ?? {})).toEqual(['google_search']);
});

it('sem chave: só no catálogo, com os modelos de áudio e busca', async () => {
  const google = await start();

  expect(google?.key).toEqual({ plugin: 'ai-google', path: 'key', configured: false });
  expect(google?.models?.every((m) => m.audio && m.nativeSearch)).toBe(true);
});
