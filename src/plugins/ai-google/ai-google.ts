import { createGoogle } from '@ai-sdk/google';
import type { PluginDefinition } from '@usebridger/core';
import { keyProvider } from '#plugins/ai/key-provider.ts';

/** Provider `google` (Gemini) em `ai.providers`: texto, imagem e a busca nativa (Google Grounding). */
export const aiGoogle: PluginDefinition = keyProvider({
  plugin: 'ai-google',
  version: '0.1.0',
  provider: {
    name: 'google',
    label: 'Google',
    temperature: { min: 0, max: 2 },
    models: [
      { id: 'gemini-2.5-flash', audio: true, nativeSearch: true },
      { id: 'gemini-2.5-flash-lite', audio: true, nativeSearch: true },
      { id: 'gemini-2.5-pro', audio: true, nativeSearch: true },
    ],
  },
  create: (apiKey) => {
    const google = createGoogle({ apiKey });
    return {
      languageModel: (id) => google.languageModel(id),
      imageModel: (id) => google.image(id),
      nativeSearch: () => ({ google_search: google.tools.googleSearch({}) }),
    };
  },
});
