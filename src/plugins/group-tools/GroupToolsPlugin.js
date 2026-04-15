import { COMMANDS } from "../../config/constants.js";
import { GroupManager } from "../../managers/GroupManager.js";

/**
 * Plugin de ferramentas de grupo: menciona todos os participantes.
 * Comandos: @everyone (e @todos, que o CommandRouter normaliza para @everyone)
 */
export class GroupToolsPlugin {
  static commands = [COMMANDS.EVERYONE];

  async onCommand(command, bot) {
    await bot.react("📢");
    if (bot.isGroup) {
      await GroupManager.mentionEveryone(bot.raw, bot.socket);
    } else {
      await bot.reply("⚠️ Este comando só funciona em grupos!");
    }
  }
}
