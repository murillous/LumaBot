import { COMMANDS } from "../../config/constants.js";
import { UserResolver } from "../../core/services/UserResolver.js";

/**
 * Plugin de identidade de usuário: apelidos manuais.
 *
 * - !apelido <nome>          → define o apelido de quem enviou
 * - !alcunha @fulano <nome>  → define o apelido da pessoa mencionada
 *
 * O apelido tem prioridade máxima na exibição (rankings, lembretes, logs),
 * resolvendo casos de JID @lid, pushName ausente ou nome desatualizado.
 */
export class UserPlugin {
  static commands = [COMMANDS.NICK, COMMANDS.NICK_ALT];

  async onCommand(command, bot) {
    const body = bot.body || "";

    if (command === COMMANDS.NICK) {
      const nick = body.slice(COMMANDS.NICK.length).trim();
      if (!nick) {
        await bot.reply("ℹ️ Uso: *!apelido SeuNome*");
        return;
      }
      UserResolver.setNickname(bot.senderJid, nick);
      await bot.reply(`✅ Apelido definido: *${nick}*`);
      return;
    }

    // !alcunha @fulano <nome>
    const mentioned = await bot.getMentionedJids();
    if (mentioned.length === 0) {
      await bot.reply("ℹ️ Uso: *!alcunha @pessoa Nome*");
      return;
    }
    const target = mentioned[0];
    // Remove o comando e os tokens de menção (@123456) sobrando, restando só o nome.
    const nick = body
      .slice(COMMANDS.NICK_ALT.length)
      .replace(/@\d+/g, "")
      .trim();
    if (!nick) {
      await bot.reply("ℹ️ Uso: *!alcunha @pessoa Nome*");
      return;
    }
    UserResolver.setNickname(target, nick);
    await bot.reply(`✅ Apelido de @${target.split("@")[0]} definido: *${nick}*`, {
      mentions: [target],
    });
  }
}
