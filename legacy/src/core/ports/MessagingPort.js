/**
 * Porta de mensageria — contrato que todo adapter de plataforma deve satisfazer.
 *
 * Um adapter de mensageria é um objeto de contexto: encapsula a conexão e a
 * mensagem atual, expondo uma interface unificada para leitura e envio.
 *
 * Regra de ouro: handlers e plugins dependem DESTA porta, não do Baileys.
 * Trocar Baileys pela API Oficial do WhatsApp = criar WhatsAppOfficialAdapter
 * que extends MessagingPort — zero alteração no domínio.
 *
 * Leaks conhecidos (backlog):
 *  - MediaProcessor recebe bot.raw e bot.socket diretamente (precisa de
 *    downloadMediaBuffer() na porta e refatoração do MediaProcessor)
 *  - GroupManager.mentionEveryone e ToolDispatcher acessam bot.socket e
 *    bot.innerMessage (precisam de métodos específicos na porta)
 */
export class MessagingPort {

  // ── Contexto da mensagem ────────────────────────────────────────────────────

  /** Texto da mensagem atual (null se for mídia sem legenda). */
  get body() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.body`);
  }

  /** JID do chat (remetente em PV, grupo em grupo). */
  get jid() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.jid`);
  }

  /** Verdadeiro se a conversa é um grupo. */
  get isGroup() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.isGroup`);
  }

  /** Verdadeiro se a mensagem foi enviada pelo próprio bot. */
  get isFromMe() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.isFromMe`);
  }

  /** Verdadeiro se a mensagem é reply direto a uma mensagem do bot. */
  get isRepliedToMe() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.isRepliedToMe`);
  }

  /** Primeiro nome do remetente. */
  get senderName() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.senderName`);
  }

  // ── Detecção de mídia ───────────────────────────────────────────────────────

  /** Verdadeiro se contém áudio (PTT ou arquivo). */
  get hasAudio() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.hasAudio`);
  }

  /** Verdadeiro se contém imagem, vídeo ou sticker. */
  get hasVisualContent() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.hasVisualContent`);
  }

  /** Verdadeiro se a mensagem é especificamente um sticker. */
  get hasSticker() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.hasSticker`);
  }

  /** Verdadeiro se contém imagem ou vídeo (exceto sticker). */
  get hasMedia() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.hasMedia`);
  }

  /** Texto da mensagem citada (quoted), ou null se não houver. */
  get quotedText() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.quotedText`);
  }

  /** Verdadeiro se a mensagem citada é um áudio. */
  get quotedHasAudio() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.quotedHasAudio`);
  }

  /** MIME type do áudio da mensagem atual. */
  get audioMimeType() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.audioMimeType`);
  }

  /** MIME type do áudio da mensagem citada. */
  get quotedAudioMimeType() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.quotedAudioMimeType`);
  }

  // ── Acesso interno (usar com parcimônia) ────────────────────────────────────

  /**
   * Mensagem bruta do protocolo — necessário para MediaProcessor e download de mídia.
   * Todo uso direto desta propriedade no domínio é uma dependência implícita no
   * protocolo concreto; abstrair progressivamente com métodos específicos na porta.
   */
  get raw() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.raw`);
  }

  /**
   * Socket de conexão — necessário para operações de grupo e media de baixo nível.
   * Cada uso direto é um leak do Baileys para o domínio; substituir por métodos
   * específicos na porta conforme necessário.
   */
  get socket() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.socket`);
  }

  // ── Envio de mensagens ──────────────────────────────────────────────────────

  /**
   * Responde a mensagem atual com quote.
   * @param {string} text
   * @returns {Promise<object>} Metadata da mensagem enviada
   */
  async reply(text) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.reply()`);
  }

  /**
   * Envia texto, com ou sem quote explícito.
   * @param {string} text
   * @param {{ quoted?: object }} [options]
   * @returns {Promise<object>}
   */
  async sendText(text, options = {}) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendText()`);
  }

  /**
   * Envia mensagem com payload arbitrário (vídeo, documento, sticker...).
   * Usar quando não existir método específico na porta.
   * @param {string} jid
   * @param {object} content - Payload no formato do protocolo subjacente
   * @returns {Promise<object>}
   */
  async sendMessage(jid, content) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendMessage()`);
  }

  /**
   * Atualiza o indicador de presença no chat.
   * @param {'composing'|'recording'|'paused'} type
   * @returns {Promise<void>}
   */
  async sendPresence(type) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.sendPresence()`);
  }

  /**
   * Adiciona uma reação emoji à mensagem atual.
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async react(emoji) {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.react()`);
  }

  // ── Contexto adicional ──────────────────────────────────────────────────────

  /**
   * Retorna um adapter para a mensagem citada (quoted), ou null se não houver.
   * @returns {MessagingPort|null}
   */
  getQuotedAdapter() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.getQuotedAdapter()`);
  }

  /**
   * Retorna o número de telefone do remetente (sem @s.whatsapp.net).
   * @returns {Promise<string|null>}
   */
  async getSenderNumber() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.getSenderNumber()`);
  }

  /**
   * Retorna os JIDs mencionados na mensagem.
   * @returns {Promise<string[]>}
   */
  async getMentionedJids() {
    throw new Error(`${this.constructor.name} não implementou MessagingPort.getMentionedJids()`);
  }
}
