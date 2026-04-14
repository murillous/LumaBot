import { COMMANDS, MENUS } from "../../config/constants.js";

/**
 * Plugin de utilitários: help e informações do usuário.
 * Comandos: !help, !meunumero
 */
export class UtilsPlugin {
  static commands = [COMMANDS.HELP, COMMANDS.MY_NUMBER];

  async onCommand(command, bot) {
    switch (command) {
      case COMMANDS.HELP:
        await bot.sendText(MENUS.HELP_TEXT);
        break;

      case COMMANDS.MY_NUMBER: {
        const num  = await bot.getSenderNumber();
        const chat = bot.jid;
        await bot.reply(
          `📱 *Informações de ID*\n\n👤 *Seu Número:* ${num}\n💬 *ID deste Chat:* ${chat}`
        );
        break;
      }
    }
  }
}
