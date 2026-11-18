import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { keyProvider } from '#plugins/ai/key-provider.ts';
import { promptText, scripted } from '#plugins/ai/testing.ts';
import { aiContext } from './ai-context.ts';
import { assistente, exampleConfig } from './example.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

/** O `ai-deepseek` com um modelo falso: mesma config (`ai-deepseek.key`), sem rede. */
function fakeDeepseek(model: ReturnType<typeof scripted>, keys: string[]) {
  return keyProvider({
    plugin: 'ai-deepseek',
    version: '0.1.0',
    provider: { name: 'deepseek' },
    create: (apiKey) => {
      keys.push(apiKey);
      return { languageModel: () => model };
    },
  });
}

it('o exemplo mínimo responde em privado com o contexto e fica quieto em grupo', async () => {
  const model = scripted('Oi, Ana! Em que posso ajudar?');
  const keys: string[] = [];
  bot = await createTestBot({
    plugins: [ai, fakeDeepseek(model, keys), aiContext, assistente],
    pluginConfig: exampleConfig('sk-exemplo'),
  });

  await bot.receive({ text: 'bom dia, pessoal', chat: { id: 'grupo@fake', isGroup: true } });
  await bot.receive({ text: 'oi, tudo bem?', sender: { name: 'Ana' } });

  expect(keys).toEqual(['sk-exemplo']);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(promptText(model)).toMatch(/Ana: oi, tudo bem\?/);
  expect(bot.sent.at(-1)?.content).toMatchObject({ text: 'Oi, Ana! Em que posso ajudar?' });
});
