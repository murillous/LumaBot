import { type DisconnectReason, definePlugin, type PluginDefinition } from '@usebridger/core';

/** Chamado quando a reconexão desiste; o app guarda o `bot` e decide como sair. */
export type GiveUpHandler = (reason: DisconnectReason) => void;

// Com o Baileys (capability `pairing`), só estes motivos levam o bot a `failed`: `auth-failed` e
// `logged-out` limpam a sessão e pareiam de novo.
const GIVE_UP: ReadonlySet<DisconnectReason> = new Set(['fatal', 'replaced']);

/**
 * Avisa o app quando a reconexão desiste. Desde o core 0.9 o bot fica em `failed` com o processo
 * no ar (para o painel mostrar o erro); sem painel, o bot ficaria mudo sem ninguém saber, então
 * o app encerra e deixa o supervisor decidir.
 */
export function giveUp(onGiveUp: GiveUpHandler): PluginDefinition {
  return definePlugin({
    name: 'give-up',
    version: '0.0.0',
    engine: '<1.0.0',
    on: {
      'connection.status': ({ payload }) => {
        if (payload.status === 'closed' && GIVE_UP.has(payload.reason)) {
          onGiveUp(payload.reason);
        }
      },
    },
  });
}
