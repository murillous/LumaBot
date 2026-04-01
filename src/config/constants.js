export const CONFIG = {
  TEMP_DIR: "./temp",
  AUTH_DIR: "./auth_info",

  MAX_RECONNECT_ATTEMPTS: 3,
  RECONNECT_DELAY: 5000,
  MIN_CLEAN_INTERVAL: 60000,
  STICKER_SIZE: 512,
  STICKER_QUALITY: 90,
  VIDEO_DURATION: 6,
  GIF_DURATION: 8,
  GIF_FPS: 15,
  VIDEO_FPS: 15,
  MAX_FILE_SIZE: 800,
  WEBP_QUALITY: 75,
  MAX_GIF_FRAMES: 50,
  TIMEOUT_MS: 60000,
  KEEPALIVE_MS: 30000,
  IGNORE_SELF: true,
};

export const STICKER_METADATA = {
  PACK_NAME: "LumaBot  Stickers",
  AUTHOR: "Criado com ❤️ por LumaBot",
}

export const COMMANDS = {
  STICKER: "!sticker",
  STICKER_SHORT: "!s",
  IMAGE: "!image",
  IMAGE_SHORT: "!i",
  GIF: "!gif",
  GIF_SHORT: "!g",
  HELP: "!help",
  PERSONA: "!persona",
  EVERYONE: "@everyone",
  DOWNLOAD_SHORT: "!d",
  DOWNLOAD: "!download",
  LUMA_STATS: "!luma stats",
  LUMA_STATS_SHORT: "!ls",
  LUMA_CLEAR: "!luma clear",
  LUMA_CLEAR_SHORT: "!lc",
  LUMA_CLEAR_ALT: "!clear",
  MY_NUMBER: "!meunumero",
};

export const MENUS = {
  HELP_TEXT:
    "🤖 *LISTA DE COMANDOS* 🤖\n\n" +
    "🎨 *MÍDIA*\n" +
    "• *!sticker* (!s) - Imagem/Vídeo/Link -> Sticker\n" +
    "• *!gif* (!g) - Sticker Animado -> GIF\n" +
    "• *!image* (!i) - Sticker -> Imagem\n\n" +
    "🧠 *INTELIGÊNCIA ARTIFICIAL*\n" +
    "• *Luma* - Fale qualquer coisa (ex: 'Luma, bom dia')\n" +
    "• *!persona* - Abre o menu para mudar a Luma\n" +
    "• *!luma clear* (!lc ou !clear) - Limpa memória da conversa\n" +
    "• *!luma stats* (!ls) - Mostra estatísticas da Luma\n\n" +
    "🛠️ *UTILITÁRIOS*\n" +
    "• *!download* (!d) - Baixa vídeo do Twitter/X ou Instagram\n" +
    "• *!meunumero* - Vê seu ID/Número\n" +
    "• *!help* - Mostra essa lista\n" +
    "• *@everyone* ou *@todos* - Marca todos os membros do grupo\n\n" +
    "👮 *AUTOR*\n" +
    "• Feito por Murilo Castelhano\n" +
    "• Repositório: https://github.com/murillous/LumaBot",

  PERSONALITY: {
    HEADER: "🎭 *CONFIGURAÇÃO DA LUMA*\n_Responda com o código (ex: p1):_\n",
    FOOTER: "\n_A mudança é aplicada imediatamente neste chat._",
  },

  MSGS: {
    INVALID_OPT: "❌ Opção inválida. Tente p1, p2, etc.",
    PERSONA_CHANGED: "✅ Personalidade alterada para: ",
  },
};

export const MESSAGES = {
  INITIALIZING: "🤖 WhatsApp Sticker Bot - Conversor Completo",
  STICKER_COMMAND: "🔄 !sticker - Converte imagem/vídeo para sticker",
  IMAGE_COMMAND: "🖼️ !image - Converte sticker para imagem",
  GIF_COMMAND: "🎬 !gif - Converte sticker animado para GIF",
  WAITING_QR: "📱 Aguarde o QR Code...",
  CONNECTING: "🔄 Iniciando conexão com WhatsApp...",
  CONNECTED: "✅ Conectado com sucesso!",
  BOT_READY: "🎯 Bot pronto para uso",
  DISCONNECTED: "❌ Conexão fechada:",
  SEND_MEDIA_STICKER: "ℹ️ Envie uma mídia com !sticker",
  REPLY_MEDIA_STICKER: "ℹ️ Responda a uma imagem/vídeo com !sticker",
  SEND_STICKER_IMAGE: "ℹ️ Envie um sticker com !image",
  REPLY_STICKER_IMAGE: "ℹ️ Responda a um sticker com !image",
  SEND_STICKER_GIF: "ℹ️ Envie um sticker animado com !gif",
  REPLY_STICKER_GIF: "ℹ️ Responda a um sticker animado com !gif",
  STATIC_STICKER: "ℹ️ Este é um sticker estático. Use !image para converter",
  CONVERTED_IMAGE: "🖼️ Convertido!",
  EVERYONE_COMMAND: "📢 @everyone - Marca todos os integrantes do grupo",
  CONVERTED_GIF: "🎬 Convertido!",
  DOWNLOAD_ERROR: "❌ Erro ao baixar",
  CONVERSION_ERROR: "❌ Erro na conversão",
  GENERAL_ERROR: "❌ Erro",
  UNSUPPORTED_FORMAT: "❌ Formato não suportado ou arquivo corrompido.",
  VIDEO_DOWNLOADING: "⏳ Baixando vídeo...",
  VIDEO_SENT: "🎬 Pronto!",
  VIDEO_TOO_LARGE: "❌ Vídeo muito grande para enviar (máx. ~50MB).",
  VIDEO_DOWNLOAD_ERROR: "❌ Não consegui baixar esse vídeo. O conteúdo pode ser privado ou a URL inválida.",
  VIDEO_NO_URL: "ℹ️ Cole o link do vídeo junto com o comando.\nEx: `!download https://x.com/...`",
};
