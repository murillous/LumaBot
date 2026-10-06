import { COMMANDS } from "../../config/constants.js";
import { DatabaseService } from "../../services/Database.js";
import { UserResolver } from "../../core/services/UserResolver.js";

/**
 * Plugin de ranking: quem mais interage com a Luma.
 *
 * - !classif        → ranking do grupo atual (ou global em PV)
 * - !classif global → ranking agregado de todos os chats
 *
 * Os nomes são resolvidos pelo UserResolver na hora da exibição — a chave de
 * persistência é sempre o JID, nunca o nome.
 */
export class RankPlugin {
  static commands = [COMMANDS.RANK];

  #medal(index) {
    return ["🥇", "🥈", "🥉"][index] || `${index + 1}.`;
  }

  async onCommand(command, bot) {
    const body = (bot.body || "").toLowerCase();
    const isGlobal = body.includes("global") || !bot.isGroup;

    const rows = isGlobal
      ? DatabaseService.getGlobalRanking(10)
      : DatabaseService.getGroupRanking(bot.jid, 10);

    if (!rows.length) {
      await bot.reply("🤷 Ninguém interagiu comigo ainda por aqui.");
      return;
    }

    const title = isGlobal
      ? "🏆 *Ranking Global* — quem mais fala comigo"
      : "🏆 *Ranking do Grupo* — quem mais fala comigo";

    const lines = rows.map(
      (row, i) => `${this.#medal(i)} ${UserResolver.getDisplayName(row.sender_jid)} — ${row.count}`
    );

    await bot.sendText(`${title}\n\n${lines.join("\n")}`);
  }
}
