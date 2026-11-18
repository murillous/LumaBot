import { createOpenAI } from '@ai-sdk/openai';
import type { PluginDefinition } from '@usebridger/core';
import { keyProvider } from '#plugins/ai/key-provider.ts';

/** Provider `openai` em `ai.providers`: texto e imagem; sem busca nativa. */
export const aiOpenai: PluginDefinition = keyProvider({
  plugin: 'ai-openai',
  version: '0.1.0',
  provider: {
    name: 'openai',
    label: 'OpenAI',
    temperature: { min: 0, max: 2 },
    models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }],
  },
  create: (apiKey) => {
    const openai = createOpenAI({ apiKey });
    return {
      languageModel: (id) => openai.languageModel(id),
      imageModel: (id) => openai.image(id),
    };
  },
});
