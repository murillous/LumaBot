import { createAnthropic } from '@ai-sdk/anthropic';
import type { PluginDefinition } from '@usebridger/core';
import { keyProvider } from '#plugins/ai/key-provider.ts';

/** Provider `anthropic` (Claude) em `ai.providers`: só texto (lê imagem, não gera). */
export const aiAnthropic: PluginDefinition = keyProvider({
  plugin: 'ai-anthropic',
  version: '0.1.0',
  provider: {
    name: 'anthropic',
    label: 'Anthropic',
    // Os Claude 5.5 recusam `temperature` (400 sem retry, que derrubaria a cadeia).
    temperature: null,
    models: [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }],
  },
  create: (apiKey) => {
    const anthropic = createAnthropic({ apiKey });
    return { languageModel: (id) => anthropic.languageModel(id) };
  },
});
