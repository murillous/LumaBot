/**
 * Porta de mensageria — contrato que todo adapter de plataforma de mensagens deve satisfazer.
 * Abstrai operações de envio para que o domínio não dependa do Baileys diretamente.
 */
export class MessagingPort {
  /**
   * Envia uma mensagem de texto.
   * @param {string} jid - ID do chat destino
   * @param {string} text - Conteúdo da mensagem
   * @param {object} [options] - Opções adicionais (ex: { quoted: message })
   * @returns {Promise<object>} Metadata da mensagem enviada
   */
  async sendText(jid, text, options = {}) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendText()`);
  }

  /**
   * Envia uma imagem com legenda opcional.
   * @param {string} jid
   * @param {Buffer} imageBuffer
   * @param {string} [caption]
   * @returns {Promise<object>}
   */
  async sendImage(jid, imageBuffer, caption = '') {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendImage()`);
  }

  /**
   * Envia um arquivo de áudio.
   * @param {string} jid
   * @param {Buffer} audioBuffer
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async sendAudio(jid, audioBuffer, options = {}) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendAudio()`);
  }

  /**
   * Envia um vídeo.
   * @param {string} jid
   * @param {Buffer} videoBuffer
   * @param {string} [caption]
   * @returns {Promise<object>}
   */
  async sendVideo(jid, videoBuffer, caption = '') {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendVideo()`);
  }

  /**
   * Adiciona uma reação emoji a uma mensagem.
   * @param {string} jid
   * @param {object} messageKey - Chave da mensagem a reagir
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async react(jid, messageKey, emoji) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.react()`);
  }

  /**
   * Atualiza o status de presença (typing, recording...).
   * @param {string} jid
   * @param {'composing'|'recording'|'paused'} type
   * @returns {Promise<void>}
   */
  async sendPresence(jid, type) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendPresence()`);
  }

  /**
   * Retorna o JID do bot conectado.
   * @returns {string}
   */
  getBotJid() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.getBotJid()`);
  }
}
