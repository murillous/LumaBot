// Consumidor de teste do `ai.tools`: faz o papel da IA (#349) para provar cada tool antes de o
// plugin `ai` existir. Só os testes o carregam.

import { definePlugin, type PluginDefinition } from '@usebridger/core';
import type { TestBot } from '@usebridger/testing';
import { invokeTool, offeredTools } from './ai-tools.ts';

/**
 * `!tool <nome> <json>` roda a tool como a IA rodaria: só entre as oferecidas, com os argumentos
 * validados. Responde o resultado em JSON; tool não oferecida responde `not-offered`.
 */
export const aiToolsProbe: PluginDefinition = definePlugin({
  name: 'ai-tools-probe',
  version: '0.0.0',
  engine: '<1.0.0',
  commands: {
    tool: {
      run: async (ctx, plugin) => {
        const [name = '', ...rest] = ctx.rawArgs.trim().split(/\s+/);
        const json = rest.join(' ');
        const tool = offeredTools(
          plugin.services.extensionPoint('ai.tools').list(),
          plugin.capabilities,
        ).find((t) => t.name === name);
        if (!tool) return JSON.stringify({ ok: false, error: 'not-offered' });
        const result = await invokeTool(tool, json ? JSON.parse(json) : {}, {
          message: ctx.message,
          reply: ctx.reply,
          signal: ctx.signal,
          log: ctx.log,
        });
        return JSON.stringify(result);
      },
    },
  },
});

/** Resultado da última `!tool`, como o modelo o leria. */
export function toolResult(bot: TestBot): unknown {
  for (const { content } of bot.sent.toReversed()) {
    if (content.type === 'text' && content.text.startsWith('{')) return JSON.parse(content.text);
  }
  throw new Error('nenhuma !tool respondeu');
}
