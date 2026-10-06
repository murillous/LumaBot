import { LUMA_CONFIG } from '../config/lumaConfig.js';

/**
 * Remove artefatos do texto da resposta da IA.
 * @param {string} text
 * @returns {string}
 */
export function cleanResponseText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^Luma:\s*/i, '')
    .replace(/(.)\1{29,}/g, (_, char) => char.repeat(30))
    .trim();
}

/**
 * Divide o texto em partes para envio sequencial no WhatsApp.
 * Usa o separador [PARTE] se presente; caso contrário divide por pontos naturais.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxLen]   - Comprimento máximo de cada parte
 * @param {number} [options.maxParts] - Número máximo de partes
 * @returns {string[]}
 */
export function splitIntoParts(text, {
  maxLen   = LUMA_CONFIG.TECHNICAL.maxResponseLength,
  maxParts = LUMA_CONFIG.TECHNICAL.maxParts,
} = {}) {
  if (!text) return [];

  const byMarker = text
    .split('[PARTE]')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .slice(0, maxParts);

  if (byMarker.length > 1) return byMarker;
  if (text.length <= maxLen) return [text];

  const parts = [];
  let remaining = text;

  while (remaining.length > 0 && parts.length < maxParts) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }

    let cutAt = maxLen;
    for (const br of ['. ', '! ', '? ', '\n', '; ']) {
      const idx = remaining.lastIndexOf(br, maxLen);
      if (idx > maxLen * 0.4) {
        cutAt = idx + br.length;
        break;
      }
    }

    parts.push(remaining.substring(0, cutAt).trim());
    remaining = remaining.substring(cutAt).trim();
  }

  return parts.filter(p => p.length > 0);
}
