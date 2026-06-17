import { COMMANDS } from "../../config/constants.js";
import { ReminderService } from "../../core/services/ReminderService.js";
import { Logger } from "../../utils/Logger.js";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Converte "DD/MM[/AAAA] HH:mm" (horário de Brasília) em epoch ms.
 * Retorna null se o formato não bater.
 */
export function parseBrDateTime(input, currentYear) {
  const match = String(input)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const [, dd, mm, yyyy, hh, min] = match;
  const year = yyyy || currentYear;
  const iso = `${year}-${pad(mm)}-${pad(dd)}T${pad(hh)}:${pad(min)}:00-03:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Formata um lembrete para exibição legível (horário Brasília).
 */
export function formatReminderForDisplay(reminder) {
  const date = new Date(reminder.fireAt);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${min}`;
}

/**
 * Plugin de lembretes via comando manual.
 *
 * Uso: !lembrete DD/MM/AAAA HH:mm | texto   (também !lembrar)
 *      !lembretes - Lista todos os lembretes agendados neste chat
 * Pessoas marcadas na mensagem são mencionadas no disparo; sem menção, lembra
 * quem criou. O agendamento por linguagem natural fica a cargo da Luma (tool
 * schedule_reminder); este comando é a via direta e determinística.
 */
export class ReminderPlugin {
  static commands = [COMMANDS.REMINDER, COMMANDS.REMINDER_LIST];

  async onCommand(command, bot) {
    // Verifica se é comando de listagem (comando específico)
    if (command === COMMANDS.REMINDER_LIST) {
      await this.listReminders(bot);
      return;
    }

    // Processa como agendamento (comando !lembrete ou !lembrar)
    // Trabalha silenciosamente, deixando a Luma responder
    const raw = (bot.body || "").replace(/^!lembr(ete|ar)\s*/i, "").trim();

    if (!raw.includes("|")) {
      return; // Silenciosamente ignora, Luma vai responder
    }

    const [whenPart, ...rest] = raw.split("|");
    const text = rest.join("|").trim();
    const fireAt = parseBrDateTime(whenPart.trim(), new Date().getFullYear());

    if (!fireAt) {
      return; // Silenciosamente ignora, Luma vai responder
    }

    const mentioned = await bot.getMentionedJids();
    const mentionJids = mentioned.length > 0 ? mentioned : [bot.senderJid];

    try {
      ReminderService.schedule({
        chatJid: bot.jid,
        isGroup: bot.isGroup,
        creatorJid: bot.senderJid,
        mentionJids,
        text,
        datetime: fireAt,
      });
      // Não responde, deixa a Luma falar
      Logger.info(`⏰ [ReminderPlugin] Lembrete agendado silenciosamente: "${text}"`);
    } catch (error) {
      Logger.error("Erro ao agendar lembrete manual:", error);
      // Não responde no chat, apenas loga
    }
  }

  /**
   * Lista todos os lembretes pendentes do chat atual.
   */
  async listReminders(bot) {
    try {
      const reminders = ReminderService.getPendingByChat(bot.jid);

      if (reminders.length === 0) {
        await bot.socket.sendMessage(bot.jid, { text: "📝 Nenhum lembrete agendado neste chat." });
        return;
      }

      let text = `⏰ *Lembretes agendados* (${reminders.length})\n\n`;
      reminders.forEach((reminder, index) => {
        const formattedDate = formatReminderForDisplay(reminder);
        text += `*${index + 1}.* ${formattedDate}\n`;
        text += `   📌 ${reminder.text}\n\n`;
      });

      await bot.socket.sendMessage(bot.jid, { text });
    } catch (error) {
      Logger.error("Erro ao listar lembretes:", error);
    }
  }
}
