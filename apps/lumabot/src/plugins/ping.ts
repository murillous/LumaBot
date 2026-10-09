import { command, definePlugin, type PluginDefinition } from '@zapforge/core';

/** `!ping` → `pong`: prova que a mensagem atravessa o kernel e a resposta sai pelo transport. */
export const ping: PluginDefinition = definePlugin({
  name: 'ping',
  version: '0.0.0',
  engine: '<1.0.0',
  requires: ['send.text'],
  setup(ctx) {
    ctx.commands.add(
      command({
        name: 'ping',
        description: 'Responde pong',
        run: async (c) => {
          await c.reply('pong');
        },
      }),
    );
  },
});
