import { COMMANDS } from "../../config/constants.js";

/**
 * Detecta qual comando está presente em uma string de texto.
 *
 * Responsabilidade única: parsing de texto → constante COMMANDS.
 * O despacho para handlers é feito pelo PluginManager.
 *
 * @param {string|null} text
 * @returns {string|null} Uma das constantes COMMANDS ou null
 */
export class CommandRouter {
  static detect(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    if (lower === COMMANDS.MY_NUMBER)              return COMMANDS.MY_NUMBER;
    if (lower === COMMANDS.LUMA_CLEAR_SHORT)       return COMMANDS.LUMA_CLEAR;
    if (lower.includes(COMMANDS.LUMA_CLEAR))       return COMMANDS.LUMA_CLEAR;
    if (lower.includes(COMMANDS.LUMA_CLEAR_ALT))   return COMMANDS.LUMA_CLEAR_ALT;
    if (lower.includes(COMMANDS.LUMA_STATS))       return COMMANDS.LUMA_STATS;
    if (lower.includes(COMMANDS.LUMA_STATS_SHORT)) return COMMANDS.LUMA_STATS;
    if (lower.includes(COMMANDS.STICKER))          return COMMANDS.STICKER;
    if (lower.includes(COMMANDS.STICKER_SHORT))    return COMMANDS.STICKER;
    if (lower.includes(COMMANDS.IMAGE))            return COMMANDS.IMAGE;
    if (lower.includes(COMMANDS.IMAGE_SHORT))      return COMMANDS.IMAGE;
    if (lower.startsWith(COMMANDS.PDF))            return COMMANDS.PDF;
    if (lower.startsWith(COMMANDS.PDF_MERGE))      return COMMANDS.PDF_MERGE;
    if (lower.startsWith(COMMANDS.PDF_MERGE_ALT))  return COMMANDS.PDF_MERGE;
    if (lower.includes(COMMANDS.GIF))              return COMMANDS.GIF;
    if (lower.includes(COMMANDS.GIF_SHORT))        return COMMANDS.GIF;
    if (lower.includes(COMMANDS.EVERYONE.toLowerCase()) || lower === "@todos") return COMMANDS.EVERYONE;
    if (lower.includes(COMMANDS.HELP) || lower === "!menu") return COMMANDS.HELP;
    if (lower.startsWith(COMMANDS.PERSONA))        return COMMANDS.PERSONA;
    if (lower.startsWith(COMMANDS.AUDIO_DOWNLOAD))       return COMMANDS.AUDIO_DOWNLOAD;
    if (lower === COMMANDS.AUDIO_DOWNLOAD_SHORT || lower.startsWith(COMMANDS.AUDIO_DOWNLOAD_SHORT + " ")) return COMMANDS.AUDIO_DOWNLOAD;
    if (lower.startsWith(COMMANDS.DOWNLOAD))        return COMMANDS.DOWNLOAD;
    if (lower === COMMANDS.DOWNLOAD_SHORT || lower.startsWith(COMMANDS.DOWNLOAD_SHORT + " "))  return COMMANDS.DOWNLOAD;
    if (lower.startsWith(COMMANDS.RESUMO))         return COMMANDS.RESUMO;
    if (lower.startsWith(COMMANDS.NICK_ALT))       return COMMANDS.NICK_ALT;
    if (lower.startsWith(COMMANDS.NICK))           return COMMANDS.NICK;
    if (lower.startsWith(COMMANDS.RANK))           return COMMANDS.RANK;
    if (lower === COMMANDS.REMINDER_LIST)          return COMMANDS.REMINDER_LIST;
    if (lower.startsWith(COMMANDS.REMINDER_LIST))  return COMMANDS.REMINDER_LIST;
    if (lower.startsWith(COMMANDS.REMINDER_SHORT)) return COMMANDS.REMINDER;
    if (lower.startsWith(COMMANDS.REMINDER))       return COMMANDS.REMINDER;

    return null;
  }
}
