import { Logger } from "../utils/Logger.js";

/**
 * Adaptador que normaliza as mensagens do Baileys para uso interno no bot.
 * Desempacota protocolos aninhados (ephemeral, viewOnce) transparentemente.
 */
export class BaileysAdapter {
  constructor(sock, message) {
    this.sock = sock;
    this.message = message;
    this.key = message.key;
    this.remoteJid = message.key.remoteJid;
    this.isFromMe = message.key.fromMe;
  }

  // --- Getters de Informação ---

  get raw() {
    return this.message;
  }

  get socket() {
    return this.sock;
  }

  get jid() {
    return this.remoteJid;
  }

  get isGroup() {
    return this.remoteJid.endsWith("@g.us");
  }

  /**
   * Desempacota recursivamente os envelopes do WhatsApp
   * (ephemeralMessage, viewOnce, documentWithCaption).
   */
  static unwrapMessage(msg) {
    if (!msg) return null;
    let unwrapped = msg;
    let isWrapped = true;

    while (isWrapped && unwrapped) {
      isWrapped = false;
      if (unwrapped.ephemeralMessage?.message) {
        unwrapped = unwrapped.ephemeralMessage.message;
        isWrapped = true;
      } else if (unwrapped.viewOnceMessageV2?.message) {
        unwrapped = unwrapped.viewOnceMessageV2.message;
        isWrapped = true;
      } else if (unwrapped.viewOnceMessage?.message) {
        unwrapped = unwrapped.viewOnceMessage.message;
        isWrapped = true;
      } else if (unwrapped.documentWithCaptionMessage?.message) {
        unwrapped = unwrapped.documentWithCaptionMessage.message;
        isWrapped = true;
      }
    }
    return unwrapped;
  }

  /** Retorna a mensagem já desempacotada de qualquer envelope. */
  get innerMessage() {
    return BaileysAdapter.unwrapMessage(this.message?.message);
  }

  get body() {
    const msg = this.innerMessage;
    return (
      msg?.conversation ||
      msg?.extendedTextMessage?.text ||
      msg?.imageMessage?.caption ||
      msg?.videoMessage?.caption ||
      null
    );
  }

  get senderName() {
    const pushName = this.message.pushName || "Alguém";
    const match = pushName.match(/^([^\s]+)/);
    return match ? match[1] : pushName;
  }

  /**
   * Verifica se a mensagem atual é uma resposta direta a uma mensagem do bot.
   * Compara o JID e o LID para compatibilidade com dispositivos linkados.
   */
  get isRepliedToMe() {
    try {
      const msg = this.innerMessage;

      const context =
        msg?.extendedTextMessage?.contextInfo ||
        msg?.imageMessage?.contextInfo ||
        msg?.videoMessage?.contextInfo ||
        msg?.stickerMessage?.contextInfo ||
        msg?.audioMessage?.contextInfo;

      if (!context?.participant) return false;

      const me = this.sock.authState?.creds?.me;

      if (!me) {
        if (this.sock.user?.id) {
          const myId = this.sock.user.id
            .split(":")[0]
            .split("@")[0]
            .replace(/\D/g, "");
          const quotedId = context.participant
            .split(":")[0]
            .split("@")[0]
            .replace(/\D/g, "");
          return myId === quotedId;
        }
        return false;
      }

      const clean = (id) => {
        if (!id) return null;
        return id.split(":")[0].split("@")[0].replace(/\D/g, "");
      };

      const quotedClean = clean(context.participant);
      const myIdClean = clean(me.id);
      const myLidClean = clean(me.lid);

      // Comparação dupla (telefone OU dispositivo linkado)
      return quotedClean === myIdClean || (myLidClean && quotedClean === myLidClean);
    } catch (e) {
      Logger.error("Erro ao verificar reply:", e);
      return false;
    }
  }

  get quotedMessage() {
    const msg = this.innerMessage;
    const context =
      msg?.extendedTextMessage?.contextInfo ||
      msg?.imageMessage?.contextInfo ||
      msg?.videoMessage?.contextInfo ||
      msg?.stickerMessage?.contextInfo ||
      msg?.audioMessage?.contextInfo;

    return context?.quotedMessage;
  }

  get quotedText() {
    const q = this.quotedMessage;
    if (!q) return null;

    return (
      q.conversation ||
      q.extendedTextMessage?.text ||
      q.imageMessage?.caption ||
      q.videoMessage?.caption ||
      null
    );
  }

  // --- Detecção de Áudio ---

  /**
   * Verifica se a mensagem atual contém um áudio (PTT ou arquivo de áudio).
   */
  get hasAudio() {
    const msg = this.innerMessage;
    return !!(msg?.audioMessage);
  }

  /**
   * Verifica se a mensagem citada (quoted) contém um áudio.
   * Essa é a condição principal do fluxo de transcrição:
   * usuário responde a um áudio mencionando a Luma.
   */
  get quotedHasAudio() {
    const q = this.quotedMessage;
    if (!q) return false;
    const unwrapped = BaileysAdapter.unwrapMessage(q);
    return !!(unwrapped?.audioMessage || q?.audioMessage);
  }

  /**
   * Retorna o mimeType do áudio citado, necessário para a transcrição.
   */
  get quotedAudioMimeType() {
    const q = this.quotedMessage;
    if (!q) return "audio/ogg; codecs=opus";
    const unwrapped = BaileysAdapter.unwrapMessage(q);
    return (
      unwrapped?.audioMessage?.mimetype ||
      q?.audioMessage?.mimetype ||
      "audio/ogg; codecs=opus"
    );
  }

  /**
   * Retorna o mimeType do áudio da mensagem atual.
   */
  get audioMimeType() {
    const msg = this.innerMessage;
    return msg?.audioMessage?.mimetype || "audio/ogg; codecs=opus";
  }

  // --- Métodos de Envio ---

  async sendText(text, options = {}) {
    const payload = { text };
    if (options.quoted) {
      const quotedMsg =
        options.quoted instanceof BaileysAdapter
          ? options.quoted.raw
          : options.quoted;
      return await this.sock.sendMessage(this.remoteJid, payload, {
        quoted: quotedMsg,
      });
    }
    return await this.sock.sendMessage(this.remoteJid, payload);
  }

  async reply(text) {
    return await this.sendText(text, { quoted: this.raw });
  }

  async sendPresence(type) {
    return await this.sock.sendPresenceUpdate(type, this.remoteJid);
  }

  async react(emoji) {
    return await this.sock.sendMessage(this.remoteJid, {
      react: { text: emoji, key: this.key },
    });
  }

  // --- Métodos de Usuário/Grupo ---

  async getSenderNumber() {
    try {
      let jid =
        this.message.participant ||
        this.message.key.participant ||
        this.remoteJid;

      // Resolve LID para JID real se necessário
      if (jid.includes("@lid")) {
        try {
          const [result] = await this.sock.onWhatsApp(jid);
          if (result && result.jid) jid = result.jid;
        } catch (error) { }
      }

      let number = jid.split("@")[0];
      if (number.includes(":")) number = number.split(":")[0];
      return number.replace(/\D/g, "");
    } catch (error) {
      Logger.error("❌ Adapter: Erro ao pegar número", error);
      return null;
    }
  }

  async getMentionedJids() {
    return (
      this.message.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
    );
  }

  // --- Detecção de Mídia ---

  /** Verifica se há conteúdo visual (imagem, vídeo, sticker) na mensagem ou no quoted. */
  get hasVisualContent() {
    const msg = this.innerMessage;
    const quotedInner = BaileysAdapter.unwrapMessage(this.quotedMessage);

    return !!(
      msg?.imageMessage ||
      msg?.videoMessage ||
      msg?.stickerMessage ||
      quotedInner?.imageMessage ||
      quotedInner?.videoMessage ||
      quotedInner?.stickerMessage
    );
  }

  get hasMedia() {
    const msg = this.innerMessage;
    const quotedInner = BaileysAdapter.unwrapMessage(this.quotedMessage);
    return !!(
      msg?.imageMessage ||
      msg?.videoMessage ||
      quotedInner?.imageMessage ||
      quotedInner?.videoMessage
    );
  }

  get hasSticker() {
    const msg = this.innerMessage;
    const quotedInner = BaileysAdapter.unwrapMessage(this.quotedMessage);
    return !!(msg?.stickerMessage || quotedInner?.stickerMessage);
  }

  /**
   * Cria um adaptador para a mensagem citada (quoted), permitindo
   * acessar suas propriedades de mídia como se fosse uma mensagem normal.
   */
  getQuotedAdapter() {
    if (!this.quotedMessage) return null;

    const msg = this.innerMessage;
    const context =
      msg?.extendedTextMessage?.contextInfo ||
      msg?.imageMessage?.contextInfo ||
      msg?.videoMessage?.contextInfo ||
      msg?.stickerMessage?.contextInfo ||
      msg?.audioMessage?.contextInfo;

    const fakeMsg = {
      key: {
        remoteJid: this.remoteJid,
        fromMe: false,
        id: context?.stanzaId,
        participant: context?.participant,
      },
      message: this.quotedMessage,
    };

    return new BaileysAdapter(this.sock, fakeMsg);
  }
}