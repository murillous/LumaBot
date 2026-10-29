import { definePlugin, type PluginDefinition } from '@usebridger/core';
import qrcode from 'qrcode-terminal';

/** Destino do QR e do código; o app passa o stdout, os testes capturam. */
export type PairingOutput = (text: string) => void;

/**
 * Exibe no terminal o QR ou o código de pareamento que o transport emite. O log do bot só avisa
 * que chegou um QR (o valor sai em `debug`), então quem pareia precisa desta tela.
 */
export function pairing(write: PairingOutput): PluginDefinition {
  return definePlugin({
    name: 'pairing',
    version: '0.0.0',
    engine: '<1.0.0',
    // Um pareamento só conta como novo quando conecta depois de ter pedido QR ou código.
    setup: (ctx) => {
      let pending = false;
      ctx.events.on('connection.qr', () => {
        pending = true;
      });
      ctx.events.on('connection.pairing-code', () => {
        pending = true;
      });
      ctx.events.on('connection.status', ({ payload }) => {
        if (payload.status === 'open' && pending) {
          pending = false;
          ctx.audit.record({ action: 'pairing.session.paired' });
        } else if (
          payload.status === 'closed' &&
          (payload.reason === 'logged-out' || payload.reason === 'auth-failed')
        ) {
          ctx.audit.record({ action: 'pairing.session.lost', details: { reason: payload.reason } });
        }
      });
    },
    on: {
      'connection.qr': ({ payload }) => {
        qrcode.generate(payload.qr, { small: true }, (art) => {
          write(`\nEscaneie no WhatsApp (Aparelhos conectados → Conectar aparelho):\n${art}\n`);
        });
      },
      'connection.pairing-code': ({ payload }) => {
        write(
          `\nCódigo de pareamento: ${payload.code}\n` +
            'No WhatsApp: Aparelhos conectados → Conectar com número de telefone.\n',
        );
      },
    },
  });
}
