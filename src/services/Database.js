import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const pathPrivate = path.join(DATA_DIR, "luma_private.sqlite");
const dbPrivate = new Database(pathPrivate);

const pathMetrics = path.join(DATA_DIR, "luma_metrics.sqlite");
const dbMetrics = new Database(pathMetrics);


dbPrivate.pragma("journal_mode = WAL");
dbMetrics.pragma("journal_mode = WAL");


dbPrivate.exec(`
  CREATE TABLE IF NOT EXISTS chat_settings (
    jid TEXT PRIMARY KEY,
    personality TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Perfis de usuário (JID → melhor nome humano disponível).
// Identidade técnica = jid/lid; o nome é enriquecido ao longo do tempo a partir
// de mensagens, eventos de contato e metadata de grupo.
dbPrivate.exec(`
  CREATE TABLE IF NOT EXISTS wa_users (
    jid           TEXT PRIMARY KEY,
    lid           TEXT,
    phone_number  TEXT,
    push_name     TEXT,
    contact_name  TEXT,
    notify_name   TEXT,
    verified_name TEXT,
    bot_nickname  TEXT,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Contagem de interações com a Luma (quem mais a aciona).
// group_jid = '_pv_' para conversas privadas. Contém JIDs → banco privado.
dbPrivate.exec(`
  CREATE TABLE IF NOT EXISTS luma_interactions (
    group_jid  TEXT NOT NULL,
    sender_jid TEXT NOT NULL,
    count      INTEGER DEFAULT 0,
    last_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_jid, sender_jid)
  );
  CREATE INDEX IF NOT EXISTS idx_interactions_group ON luma_interactions(group_jid, count DESC);
`);

// Lembretes agendados. fire_at = epoch ms (UTC). mention_jids = JSON array.
// Persistido para sobreviver a reinícios do bot.
dbPrivate.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_jid     TEXT NOT NULL,
    is_group     INTEGER NOT NULL DEFAULT 0,
    creator_jid  TEXT NOT NULL,
    mention_jids TEXT NOT NULL DEFAULT '[]',
    text         TEXT NOT NULL,
    fire_at      INTEGER NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    fired        INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(fired, fire_at);
`);

// Personas customizadas por chat (JID). Cada chat tem suas próprias personas
// criadas via descrição livre; predefinidas vivem no código e são imutáveis.
// traits_json = JSON array de strings. UNIQUE (chat_jid, key) evita slug duplicado.
dbPrivate.exec(`
  CREATE TABLE IF NOT EXISTS custom_personas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_jid    TEXT NOT NULL,
    key         TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    context     TEXT NOT NULL,
    style       TEXT NOT NULL,
    traits_json TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (chat_jid, key)
  );
  CREATE INDEX IF NOT EXISTS idx_custom_personas_chat ON custom_personas(chat_jid);
`);

dbMetrics.exec(`
  CREATE TABLE IF NOT EXISTS metrics (
    key TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data TEXT NOT NULL
  );
`);

export class DatabaseService {

  static getPersonality(jid) {
    const stmt = dbPrivate.prepare("SELECT personality FROM chat_settings WHERE jid = ?");
    const row = stmt.get(jid);
    return row ? row.personality : null;
  }

  static setPersonality(jid, personalityKey) {
    const stmt = dbPrivate.prepare(`
      INSERT INTO chat_settings (jid, personality, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(jid) DO UPDATE SET 
        personality = excluded.personality,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(jid, personalityKey);
  }

  static incrementMetric(key) {
    const stmt = dbMetrics.prepare(`
      INSERT INTO metrics (key, count) 
      VALUES (?, 1)
      ON CONFLICT(key) DO UPDATE SET count = count + 1
    `);
    stmt.run(key);
  }

  static getMetrics() {
    const stmt = dbMetrics.prepare("SELECT key, count FROM metrics");
    const rows = stmt.all();

    const stats = {};
    rows.forEach(row => {
      stats[row.key] = row.count;
    });
    return stats;
  }

  static saveSnapshot(fullStats) {
    const stmt = dbMetrics.prepare("INSERT INTO stats_history (data) VALUES (?)");
    stmt.run(JSON.stringify(fullStats));
  }

  static getHistory(limit = 5) {
    const stmt = dbMetrics.prepare("SELECT timestamp, data FROM stats_history ORDER BY id DESC LIMIT ?");
    return stmt.all(limit).map(row => {
      let stats = null;
      try {
        stats = JSON.parse(row.data);
      } catch (e) {
        // Dado corrompido no banco — ignora silenciosamente
      }
      return { date: row.timestamp, stats };
    });
  }

  // === PERFIS DE USUÁRIO (wa_users) ===

  /**
   * Cria ou enriquece o perfil de um usuário. Campos vazios/undefined nunca
   * sobrescrevem dados já preenchidos — evita apagar um nome bom com um vazio.
   * @param {string} jid
   * @param {{lid?:string, phoneNumber?:string, pushName?:string, contactName?:string,
   *          notifyName?:string, verifiedName?:string, botNickname?:string}} data
   */
  static upsertWaUser(jid, data = {}) {
    if (!jid) return;

    dbPrivate
      .prepare("INSERT INTO wa_users (jid) VALUES (?) ON CONFLICT(jid) DO NOTHING")
      .run(jid);

    const columns = {
      lid: data.lid,
      phone_number: data.phoneNumber,
      push_name: data.pushName,
      contact_name: data.contactName,
      notify_name: data.notifyName,
      verified_name: data.verifiedName,
      bot_nickname: data.botNickname,
    };

    const sets = [];
    const values = [];
    for (const [col, val] of Object.entries(columns)) {
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        sets.push(`${col} = ?`);
        values.push(val);
      }
    }

    sets.push("last_seen_at = CURRENT_TIMESTAMP");
    values.push(jid);
    dbPrivate.prepare(`UPDATE wa_users SET ${sets.join(", ")} WHERE jid = ?`).run(...values);
  }

  static getWaUser(jid) {
    if (!jid) return null;
    return dbPrivate.prepare("SELECT * FROM wa_users WHERE jid = ?").get(jid) || null;
  }

  static getAllWaUsers() {
    return dbPrivate.prepare("SELECT * FROM wa_users ORDER BY last_seen_at DESC").all();
  }

  /** Define o apelido manual (prioridade máxima na exibição). */
  static setNickname(jid, nickname) {
    if (!jid) return;
    dbPrivate.prepare(`
      INSERT INTO wa_users (jid, bot_nickname) VALUES (?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        bot_nickname = excluded.bot_nickname,
        last_seen_at = CURRENT_TIMESTAMP
    `).run(jid, nickname);
  }

  // === RANKING DE INTERAÇÕES COM A LUMA (luma_interactions) ===

  /** Incrementa o contador de interações de um usuário em um chat. */
  static incrementInteraction(groupJid, senderJid) {
    if (!groupJid || !senderJid) return;
    dbPrivate.prepare(`
      INSERT INTO luma_interactions (group_jid, sender_jid, count, last_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(group_jid, sender_jid) DO UPDATE SET
        count = count + 1,
        last_at = CURRENT_TIMESTAMP
    `).run(groupJid, senderJid);
  }

  /** Ranking de um chat específico, ordenado por interações. */
  static getGroupRanking(groupJid, limit = 10) {
    return dbPrivate.prepare(`
      SELECT sender_jid, count, last_at FROM luma_interactions
      WHERE group_jid = ?
      ORDER BY count DESC
      LIMIT ?
    `).all(groupJid, limit);
  }

  /** Ranking global agregado por usuário (soma de todos os chats). */
  static getGlobalRanking(limit = 10) {
    return dbPrivate.prepare(`
      SELECT sender_jid, SUM(count) AS count, MAX(last_at) AS last_at
      FROM luma_interactions
      GROUP BY sender_jid
      ORDER BY count DESC
      LIMIT ?
    `).all(limit);
  }

  // === LEMBRETES (reminders) ===

  static addReminder({ chatJid, isGroup, creatorJid, mentionJids, text, fireAt }) {
    const info = dbPrivate.prepare(`
      INSERT INTO reminders (chat_jid, is_group, creator_jid, mention_jids, text, fire_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(chatJid, isGroup ? 1 : 0, creatorJid, JSON.stringify(mentionJids ?? []), text, fireAt);
    return info.lastInsertRowid;
  }

  /** Lembretes vencidos ainda não disparados. */
  static getDueReminders(nowMs) {
    return dbPrivate
      .prepare("SELECT * FROM reminders WHERE fired = 0 AND fire_at <= ? ORDER BY fire_at ASC")
      .all(nowMs);
  }

  /** Todos os lembretes pendentes (futuros), para listagem/dashboard. */
  static getPendingReminders() {
    return dbPrivate
      .prepare("SELECT * FROM reminders WHERE fired = 0 ORDER BY fire_at ASC")
      .all();
  }

  static markReminderFired(id) {
    dbPrivate.prepare("UPDATE reminders SET fired = 1 WHERE id = ?").run(id);
  }

  static deleteReminder(id) {
    dbPrivate.prepare("DELETE FROM reminders WHERE id = ?").run(id);
  }

  // === PERSONAS CUSTOMIZADAS (custom_personas) ===

  /**
   * Cria uma persona custom para o chat. Respeita UNIQUE (chat_jid, key):
   * tentar criar com key já existente no chat lança erro do better-sqlite3.
   * @param {string} chatJid
   * @param {{key:string, name:string, description:string, context:string,
   *          style:string, traits:string[]}} persona
   */
  static createCustomPersona(chatJid, persona) {
    const info = dbPrivate.prepare(`
      INSERT INTO custom_personas (chat_jid, key, name, description, context, style, traits_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      chatJid,
      persona.key,
      persona.name,
      persona.description,
      persona.context,
      persona.style,
      JSON.stringify(persona.traits ?? [])
    );
    return info.lastInsertRowid;
  }

  /** Lista as personas custom de um chat, com traits desserializado. */
  static getCustomPersonas(chatJid) {
    const rows = dbPrivate
      .prepare("SELECT * FROM custom_personas WHERE chat_jid = ? ORDER BY id ASC")
      .all(chatJid);
    return rows.map((row) => DatabaseService.#mapCustomPersona(row));
  }

  /** Persona custom individual de um chat, ou null se não existir. */
  static getCustomPersona(chatJid, key) {
    const row = dbPrivate
      .prepare("SELECT * FROM custom_personas WHERE chat_jid = ? AND key = ?")
      .get(chatJid, key);
    return row ? DatabaseService.#mapCustomPersona(row) : null;
  }

  /** Remove uma persona custom; retorna true se algo foi removido. */
  static deleteCustomPersona(chatJid, key) {
    const info = dbPrivate
      .prepare("DELETE FROM custom_personas WHERE chat_jid = ? AND key = ?")
      .run(chatJid, key);
    return info.changes > 0;
  }

  /** Contagem de personas custom de um chat. */
  static countCustomPersonas(chatJid) {
    const row = dbPrivate
      .prepare("SELECT COUNT(*) AS total FROM custom_personas WHERE chat_jid = ?")
      .get(chatJid);
    return row.total;
  }

  /** Converte uma linha do banco no shape de persona (traits desserializado). */
  static #mapCustomPersona(row) {
    let traits = [];
    try {
      traits = JSON.parse(row.traits_json);
    } catch (e) {
      // traits_json corrompido — devolve lista vazia em vez de quebrar a resolução
    }
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      context: row.context,
      style: row.style,
      traits,
      createdAt: row.created_at,
    };
  }
}