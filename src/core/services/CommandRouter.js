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
    if (lower.includes("!clear"))                  return COMMANDS.LUMA_CLEAR_ALT;
    if (lower.includes(COMMANDS.LUMA_STATS))       return COMMANDS.LUMA_STATS;
    if (lower.includes(COMMANDS.LUMA_STATS_SHORT)) return COMMANDS.LUMA_STATS;
    if (lower.includes(COMMANDS.STICKER))          return COMMANDS.STICKER;
    if (lower.includes(COMMANDS.STICKER_SHORT))    return COMMANDS.STICKER;
    if (lower.includes(COMMANDS.IMAGE))            return COMMANDS.IMAGE;
    if (lower.includes(COMMANDS.IMAGE_SHORT))      return COMMANDS.IMAGE;
    if (lower.includes(COMMANDS.GIF))              return COMMANDS.GIF;
    if (lower.includes(COMMANDS.GIF_SHORT))        return COMMANDS.GIF;
    if (lower.includes(COMMANDS.EVERYONE.toLowerCase()) || lower === "@todos") return COMMANDS.EVERYONE;
    if (lower.includes(COMMANDS.HELP) || lower === "!menu") return COMMANDS.HELP;
    if (lower.startsWith(COMMANDS.PERSONA))        return COMMANDS.PERSONA;
    if (lower.startsWith(COMMANDS.DOWNLOAD))       return COMMANDS.DOWNLOAD;
    if (lower.startsWith(COMMANDS.DOWNLOAD_SHORT)) return COMMANDS.DOWNLOAD;

    return null;
  }
}
