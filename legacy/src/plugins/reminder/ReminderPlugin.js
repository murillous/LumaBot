import { COMMANDS } from "../../config/constants.js";
import { ReminderService } from "../../core/services/ReminderService.js";
import { Logger } from "../../utils/Logger.js";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Converte "DD/MM[/AAAA] HH:mm" em timestamp.
 * Retorna null para formato ou data inválida.
 */
function formatRemainingTime(fireAt) {
  const diffMs = fireAt - Date.now();

  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 60) {
    return `⏳ Faltam ${minutes} minuto(s)`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `⏳ Faltam ${hours} hora(s)`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `⏳ Faltam ${days} dia(s)`;
  }

  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;

  return remainingDays === 0
    ? `⏳ Faltam ${weeks} semana(s)`
    : `⏳ Faltam ${weeks} semana(s) e ${remainingDays} dia(s)`;
}

export function parseBrDateTime(input, currentYear) {
  const match = String(input)
    .trim()
    .match(
      /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/
    );

  if (!match) return null;

  const [, ddStr, mmStr, yyyyStr, hhStr, minStr] = match;

  const day = Number(ddStr);
  const month = Number(mmStr);
  const year = Number(yyyyStr || currentYear);
  const hour = Number(hhStr);
  const minute = Number(minStr);

  const date = new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    0,
    0
  );

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date.getTime();
}

/**
 * Formata um lembrete para exibição.
 */
export function formatReminderForDisplay(reminder) {
  const date = new Date(reminder.fireAt);

  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());

  return `${dd}/${mm} ${hh}:${min}`;
}

export class ReminderPlugin {
  static commands = [
    COMMANDS.REMINDER,
    COMMANDS.REMINDER_LIST,
    COMMANDS.REMINDER_CANCEL,
  ];

  async onCommand(command, bot) {
    if (
      command === COMMANDS.REMINDER_LIST ||
      command === "!lembretes"
    ) {
      await this.listReminders(bot);
      return;
    }
    if (command === COMMANDS.REMINDER_CANCEL) {
      const index = Number.parseInt(
        (bot.body || "").trim().split(" ")[1],
        10
      );

      if (!Number.isInteger(index)) {
        await bot.reply(
          "❌ Use: !cancelarlembrete <número>"
        );
        return;
      }

      const reminders = (ReminderService
        .getPendingByChat(bot.jid) || [])
        .sort((a, b) => a.fireAt - b.fireAt);

      const reminder = reminders[index - 1];

      if (!reminder) {
        await bot.reply("❌ Lembrete não encontrado.");
        return;
      }

      ReminderService.cancel(reminder.id);

      await bot.reply(
        `✅ Lembrete removido:\n\n${reminder.text}`
      );

      return;
    }

    const raw = (bot.body || "")
      .replace(/^!lembr(ete|ar)\s*/i, "")
      .trim();

    if (!raw.includes("|")) {
      await bot.reply(
        "Formato inválido. Use: DD/MM HH:mm | mensagem"
      );
      return;
    }

    const [whenPart, ...rest] = raw.split("|");

    const text = rest.join("|").trim();

    if (!text) {
      await bot.reply("Informe a mensagem do lembrete.");
      return;
    }

    const fireAt = parseBrDateTime(
      whenPart.trim(),
      new Date().getFullYear()
    );

    if (!fireAt) {
      await bot.reply(
        "❌ A data informada não existe no calendário."
      );
      return;
    }

    let mentionJids = [];

    try {
      if (typeof bot.getMentionedJids === "function") {
        const mentioned = await bot.getMentionedJids();

        mentionJids =
          mentioned && mentioned.length > 0
            ? mentioned
            : [bot.senderJid];
      } else {
        mentionJids = [bot.senderJid];
      }
    } catch {
      mentionJids = [bot.senderJid];
    }

    try {
      ReminderService.schedule({
        chatJid: bot.jid,
        isGroup: bot.isGroup,
        creatorJid: bot.senderJid,
        mentionJids,
        text,
        datetime: fireAt,
      });

      await bot.reply(
        `✅ Lembrete criado!\n\n` +
        `${formatReminderForDisplay({ fireAt })}\n` +
        `${text}`
      );

      Logger.info(
        `[ReminderPlugin] Lembrete criado: "${text}"`
      );
    } catch (error) {
      Logger.error(
        "[ReminderPlugin] Erro ao criar lembrete:",
        error
      );

      await bot.reply(
        error?.message || "Erro ao criar lembrete."
      );
    }
  }

  async listReminders(bot) {
    try {
      const reminders = (ReminderService
        .getPendingByChat(bot.jid) || [])
        .sort((a, b) => a.fireAt - b.fireAt);

        console.log(reminders);

      if (!reminders || reminders.length === 0) {
        await bot.reply(
          "📝 Nenhum lembrete agendado neste chat."
        );
        return;
      }

      let message =
        `⏰ Lembretes agendados (${reminders.length})\n\n`;

      reminders.forEach((reminder, index) => {
        message +=
          `${index + 1}. ${formatReminderForDisplay(
            reminder
          )}\n`;

        message +=
          `   ${reminder.text}\n`;

        message +=
          `   ${formatRemainingTime(
            reminder.fireAt
          )}\n\n`;
      });

      const now = new Date();

      const total = reminders.length;

      const today = reminders.filter(reminder => {
        const date = new Date(reminder.fireAt);

        return (
          date.getDate() === now.getDate() &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      }).length;

      const weekLimit =
        Date.now() +
        (7 * 24 * 60 * 60 * 1000);

      const week = reminders.filter(
        reminder =>
          reminder.fireAt >= Date.now() &&
          reminder.fireAt <= weekLimit
      ).length;

      const month = reminders.filter(reminder => {
        const date = new Date(reminder.fireAt);

        return (
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      }).length;

      const nextReminder = reminders[0];

      message +=
        `📊 Estatísticas\n\n` +
        `Total: ${total}\n` +
        `Hoje: ${today}\n` +
        `Esta semana: ${week}\n` +
        `Este mês: ${month}\n\n`;

      if (nextReminder) {
        message +=
          `📌 Próximo lembrete\n\n` +
          `${formatReminderForDisplay(
            nextReminder
          )}\n` +
          `${nextReminder.text}\n`;
      }

      await bot.reply(message);

    } catch (error) {
      Logger.error(
        "[ReminderPlugin] Erro ao listar lembretes:",
        error
      );

      await bot.reply(
        "Erro ao listar lembretes."
      );
    }
  }
}

