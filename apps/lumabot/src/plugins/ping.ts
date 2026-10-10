import { definePlugin, type PluginDefinition } from '@zapforge/core';

/** `!ping` → `pong`: prova que a mensagem atravessa o kernel e a resposta sai pelo transport. */
export const ping: PluginDefinition = definePlugin({
  name: 'ping',
  version: '0.0.0',
  engine: '<1.0.0',
  commands: {
    ping: { description: 'Responde pong', run: () => 'pong' },
  },
});
