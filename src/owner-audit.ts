import { definePlugin, type PluginDefinition } from '@usebridger/core';

/**
 * Audita toda execução de comando `role: 'owner'` num ponto só, em vez de cada comando se
 * lembrar de registrar. O kernel só deixa gravar com o prefixo do plugin, então o plugin se
 * chama `command` e a ação sai como `command.owner` (o core só exige o prefixo `command.`).
 */
export const ownerAudit: PluginDefinition = definePlugin({
  name: 'command',
  version: '0.0.0',
  engine: '<1.0.0',
  setup: (ctx) => {
    ctx.events.on('command', ({ payload }) => {
      const info = ctx.commands
        .list()
        .find((c) => c.plugin === payload.plugin && c.name === payload.name);
      if (info?.role !== 'owner') return;
      ctx.audit.record({
        action: 'command.owner',
        target: { type: 'chat', id: payload.message.chat.id },
        outcome:
          payload.status === 'ran' ? 'success' : payload.status === 'rejected' ? 'denied' : 'error',
        // Só o nome do comando: os argumentos podem carregar texto do usuário.
        details: {
          plugin: payload.plugin,
          command: payload.name,
          invokedAs: payload.invokedAs,
          sender: payload.message.sender.id,
        },
      });
    });
  },
});
