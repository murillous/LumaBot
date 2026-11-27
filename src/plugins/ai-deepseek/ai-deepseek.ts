import { createDeepSeek } from '@ai-sdk/deepseek';
import type { PluginDefinition } from '@usebridger/core';
import { keyProvider } from '#plugins/ai/key-provider.ts';

/** Provider `deepseek` em `ai.providers`: só texto, sem entrada de áudio nem busca nativa. */
export const aiDeepseek: PluginDefinition = keyProvider({
  plugin: 'ai-deepseek',
  version: '0.1.0',
  provider: {
    name: 'deepseek',
    label: 'DeepSeek',
    temperature: { min: 0, max: 2 },
    models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
  },
  create: (apiKey) => {
    const deepseek = createDeepSeek({ apiKey });
    return { languageModel: (id) => deepseek.languageModel(id) };
  },
});
