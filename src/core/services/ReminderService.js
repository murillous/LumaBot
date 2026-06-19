import { DatabaseService } from "../../services/Database.js";

const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000; // 1 ano
const MAX_TEXT_LENGTH = 500;

/**
 * Serviço de lembretes. Valida e persiste lembretes; normaliza as linhas do
 * banco (mention_jids vira array). O disparo no horário é responsabilidade do
 * ReminderScheduler.
 *
 * A data/hora chega como ISO 8601 absoluto (a IA calcula a partir do
 * {{CURRENT_DATETIME}} de Brasília) ou como epoch ms (comando manual).
 */
export class ReminderService {
  /**
   * Agenda um lembrete. Lança erro com mensagem amigável em caso de validação.
   * @returns {{id:number, fireAt:number, text:string, mentionJids:string[]}}
   */
  static schedule({ chatJid, isGroup, creatorJid, mentionJids = [], text, datetime, now = Date.now() }) {
    if (!chatJid || !creatorJid) throw new Error("Chat ou autor ausente.");

    const fireAt = ReminderService.parseDatetime(datetime);
    if (!Number.isFinite(fireAt)) throw new Error("Data/hora inválida.");
    if (fireAt <= now) throw new Error("A data/hora precisa estar no futuro.");
    if (fireAt - now > MAX_HORIZON_MS) throw new Error("Lembrete muito distante (máx. 1 ano).");

    const cleanText = String(text ?? "").trim().slice(0, MAX_TEXT_LENGTH);
    if (!cleanText) throw new Error("Texto do lembrete vazio.");

    const mentions = Array.from(new Set((mentionJids ?? []).filter(Boolean)));

    const id = DatabaseService.addReminder({
      chatJid,
      isGroup: !!isGroup,
      creatorJid,
      mentionJids: mentions,
      text: cleanText,
      fireAt,
    });

    return { id, fireAt, text: cleanText, mentionJids: mentions };
  }

  /** Converte ISO 8601 (string) ou epoch ms (number) em epoch ms. */
  static parseDatetime(datetime) {
    if (typeof datetime === "number") return datetime;
    if (typeof datetime !== "string") return NaN;
    return Date.parse(datetime);
  }

  static getDue(nowMs) {
    return DatabaseService.getDueReminders(nowMs).map(ReminderService.normalize);
  }

  static getPending() {
    return DatabaseService.getPendingReminders().map(ReminderService.normalize);
  }

  /** Lembretes pendentes de um chat específico. */
  static getPendingByChat(chatJid) {
    return DatabaseService.getPendingRemindersByChat(chatJid).map(ReminderService.normalize);
  }

  static markFired(id) {
    DatabaseService.markReminderFired(id);
  }

  static cancel(id) {
    DatabaseService.deleteReminder(id);
  }

  /** Converte uma linha do banco em objeto de domínio (mention_jids → array). */
  static normalize(row) {
    let mentionJids = [];
    try {
      const parsed = JSON.parse(row.mention_jids);
      if (Array.isArray(parsed)) mentionJids = parsed;
    } catch {
      mentionJids = [];
    }
    return {
      id: row.id,
      chatJid: row.chat_jid,
      isGroup: !!row.is_group,
      creatorJid: row.creator_jid,
      mentionJids,
      text: row.text,
      fireAt: row.fire_at,
      fired: !!row.fired,
    };
  }
}
