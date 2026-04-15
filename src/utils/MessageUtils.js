/**
 * Utilitários puros para análise de mensagens do WhatsApp.
 * Sem dependências de handlers — pode ser importado por qualquer módulo.
 */

/**
 * Determina o tipo de mídia de uma mensagem Baileys.
 * @param {object} message - Objeto de mensagem raw do Baileys
 * @returns {'image'|'gif'|'video'} Tipo da mídia
 */
export function getMessageType(message) {
  if (message.message?.imageMessage) {
    return message.message.imageMessage.mimetype?.includes("gif") ? "gif" : "image";
  }
  if (message.message?.videoMessage) {
    return message.message.videoMessage.gifPlayback ? "gif" : "video";
  }
  return "image";
}

/**
 * Extrai a primeira URL encontrada num texto.
 * @param {string|null} text
 * @returns {string|null}
 */
export function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/(https?:\/\/[^\s]+)/g);
  return match ? match[0] : null;
}
