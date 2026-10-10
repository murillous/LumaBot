import { definePlugin, type PluginDefinition } from '@zapforge/core';
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
