import { Logger } from '../utils/Logger.js';

/**
 * Exibe o QR code no terminal e sinaliza o dashboard via stdout.
 *
 * @param {string} qr - String raw do QR code gerado pelo Baileys
 * @param {object} context
 * @param {number} context.attempt     - Tentativa atual
 * @param {number} context.maxAttempts - Máximo de tentativas
 */
export async function presentQrCode(qr, { attempt, maxAttempts }) {
  Logger.info(`\n📱 QR Code gerado! (Tentativa ${attempt}/${maxAttempts})`);
  Logger.info('📶 IMPORTANTE: Certifique-se de ter boa conexão no celular!\n');

  // Sinal para o dashboard renderizar o QR no browser
  process.stdout.write(`[LUMA_QR]:${qr}\n`);

  const qrcode = await _loadQrCodeTerminal();
  if (qrcode) {
    qrcode.generate(qr, { small: true });
  } else {
    Logger.info('QR Code (texto):', qr);
    Logger.info('\n💡 Instale qrcode-terminal para QR visual\n');
  }

  Logger.info('\n⏰ QR Code expira em ~60 segundos');
}

async function _loadQrCodeTerminal() {
  try {
    const m = await import('qrcode-terminal');
    return m.default;
  } catch {
    return null;
  }
}
