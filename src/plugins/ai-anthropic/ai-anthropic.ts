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
    // O Claude aceita `temperature` só até 1.
    temperature: { min: 0, max: 1 },
    models: [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }],
  },
  create: (apiKey) => {
    const anthropic = createAnthropic({ apiKey });
    return { languageModel: (id) => anthropic.languageModel(id) };
  },
});
