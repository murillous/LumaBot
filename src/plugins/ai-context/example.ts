// O exemplo mínimo da doc (docs/ai-context.md#exemplo-mínimo): um assistente que responde em
// conversa privada com o contexto completo. O `example.test.ts` o roda com um modelo falso.

import { definePlugin, type PluginConfigFile, type PluginDefinition } from '@usebridger/core';

/** Responde toda fala em privado pelo `aiContext`; em grupo, fica quieto. */
export const assistente: PluginDefinition = definePlugin({
  name: 'assistente',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { 'ai-context': '^0.1.0' },
  setup: (ctx) => {
    ctx.events.on('message', async (e) => {
      if (e.message.chat.isGroup) return;
      await ctx.services.get('aiContext').respond({
        message: e.message,
        reply: e.reply,
        signal: e.signal,
        log: e.log,
        instructions: '# Quem você é\nVocê é um assistente prestativo e direto.',
      });
    });
  },
});

/** A config do exemplo: a chave do provider, a cadeia do `ai` e o `ai-context` com os padrões. */
export const exampleConfig = (key: string): PluginConfigFile => ({
  'ai-deepseek': { key },
  ai: { models: [{ model: 'deepseek:deepseek-chat' }] },
  'ai-context': { name: 'Assistente' },
});
