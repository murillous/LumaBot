import { Logger } from "../utils/Logger.js";
import { ReminderService } from "../core/services/ReminderService.js";

/**
 * Agendador de lembretes. Verifica periodicamente os lembretes vencidos e os
 * dispara mencionando as pessoas alvo no chat de origem (grupo ou PV).
 *
 * Recebe o socket atual via start(sock) — chamado a cada conexão aberta — para
 * sempre usar a sessão válida após reconexões. Os lembretes vivem no SQLite,
 * então sobrevivem a reinícios: o primeiro tick recupera o que venceu offline.
 */
export class ReminderScheduler {
  #sock = null;
  #intervalId = null;
  #ticking = false;

  constructor({ intervalMs = 30000 } = {}) {
    this.intervalMs = intervalMs;
  }

  /** (Re)associa o socket e garante o loop ativo (idempotente). */
  start(sock) {
    this.#sock = sock;
    if (this.#intervalId) return;
    this.#intervalId = setInterval(() => this.#safeTick(), this.intervalMs);
    this.#safeTick(); // varredura imediata para lembretes vencidos durante downtime
  }

  stop() {
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
  }

  #safeTick() {
    this.tick().catch((error) => Logger.error("[ReminderScheduler] Erro no tick:", error));
  }

  async tick() {
    if (!this.#sock) return;
    const due = ReminderService.getDue(Date.now());
    for (const reminder of due) {
      try {
        await this.fire(reminder);
        ReminderService.markFired(reminder.id);
      } catch (error) {
        Logger.error(`[ReminderScheduler] Falha ao disparar lembrete ${reminder.id}:`, error);
      }
    }
  }

  async fire(reminder) {
    const mentions = reminder.mentionJids ?? [];
    const mentionText = mentions.map((jid) => `@${jid.split("@")[0]}`).join(" ");
    const text = `⏰ *Lembrete:* ${reminder.text}${mentionText ? `\n${mentionText}` : ""}`;
    await this.#sock.sendMessage(reminder.chatJid, { text, mentions });
  }
}
