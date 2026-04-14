import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { StoragePort } from "../../core/ports/StoragePort.js";

/**
 * Implementação de StoragePort usando SQLite via better-sqlite3.
 *
 * Gerencia dois bancos separados (mesma estratégia do DatabaseService existente):
 * - `luma_private.sqlite` — dados pessoais: personalidades, histórico de conversa
 * - `luma_metrics.sqlite` — métricas de uso (não-sensíveis)
 *
 * O histórico de conversa passa a ser persistido em SQLite (antes ficava só em RAM
 * no LumaHandler). A tabela é criada automaticamente se não existir.
 */
export class SQLiteStorageAdapter extends StoragePort {
  /**
   * @param {object} [options]
   * @param {string} [options.dataDir='./data'] - Diretório dos bancos de dados
   */
  constructor({ dataDir = './data' } = {}) {
    super();

    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    this._private = new Database(path.join(dataDir, 'luma_private.sqlite'));
    this._metrics = new Database(path.join(dataDir, 'luma_metrics.sqlite'));

    this._private.pragma('journal_mode = WAL');
    this._metrics.pragma('journal_mode = WAL');

    this._migrate();
  }

  /** Cria as tabelas que ainda não existem (migrations aditivas). */
  _migrate() {
    // Personalidades — já existia no DatabaseService
    this._private.exec(`
      CREATE TABLE IF NOT EXISTS chat_settings (
        jid        TEXT PRIMARY KEY,
        personality TEXT NOT NULL,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Histórico de conversa — NOVO nesta fase
    this._private.exec(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        jid        TEXT    NOT NULL,
        role       TEXT    NOT NULL,
        parts_json TEXT    NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_history_jid ON conversation_history(jid);
    `);

    // Métricas — já existia no DatabaseService
    this._metrics.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        key   TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0
      );
    `);
  }

  // ---------------------------------------------------------------------------
  // Histórico de conversa
  // ---------------------------------------------------------------------------

  async getConversationHistory(jid) {
    const rows = this._private
      .prepare('SELECT role, parts_json FROM conversation_history WHERE jid = ? ORDER BY id ASC')
      .all(jid);

    return rows.map(r => ({ role: r.role, parts: JSON.parse(r.parts_json) }));
  }

  async saveMessage(jid, role, parts) {
    this._private
      .prepare('INSERT INTO conversation_history (jid, role, parts_json) VALUES (?, ?, ?)')
      .run(jid, role, JSON.stringify(parts));
  }

  async clearHistory(jid) {
    this._private
      .prepare('DELETE FROM conversation_history WHERE jid = ?')
      .run(jid);
  }

  // ---------------------------------------------------------------------------
  // Personalidades
  // ---------------------------------------------------------------------------

  async getPersonality(jid) {
    const row = this._private
      .prepare('SELECT personality FROM chat_settings WHERE jid = ?')
      .get(jid);
    return row?.personality ?? null;
  }

  async setPersonality(jid, personalityKey) {
    this._private.prepare(`
      INSERT INTO chat_settings (jid, personality, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(jid) DO UPDATE SET
        personality = excluded.personality,
        updated_at  = CURRENT_TIMESTAMP
    `).run(jid, personalityKey);
  }

  // ---------------------------------------------------------------------------
  // Métricas
  // ---------------------------------------------------------------------------

  async incrementMetric(key) {
    this._metrics.prepare(`
      INSERT INTO metrics (key, count) VALUES (?, 1)
      ON CONFLICT(key) DO UPDATE SET count = count + 1
    `).run(key);
  }

  async getMetrics() {
    const rows = this._metrics.prepare('SELECT key, count FROM metrics').all();
    return Object.fromEntries(rows.map(r => [r.key, r.count]));
  }

  // ---------------------------------------------------------------------------
  // Ciclo de vida
  // ---------------------------------------------------------------------------

  /** Fecha as conexões com os bancos. Chamar no gracefulShutdown. */
  close() {
    this._private.close();
    this._metrics.close();
  }
}
