import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

import { config } from '../config.js';
import { apiAuth, createSession, checkRateLimit } from '../auth.js';
import { pushLog, getLogs } from '../logger.js';
import { botManager } from '../botManager.js';
import { tunnelManager } from '../tunnelManager.js';
import { verifyGitHubSignature, scheduleDeploy } from '../deploy.js';

import { readConfig, writeConfig } from '../../src/config/configService.js';
import { DatabaseService }         from '../../src/services/Database.js';
import { ReminderService }         from '../../src/core/services/ReminderService.js';
import { UserResolver }            from '../../src/core/services/UserResolver.js';

export const apiRouter = Router();

// ─── Rotas públicas ───────────────────────────────────────────────────────────

apiRouter.post('/api/login', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const limit = checkRateLimit('login', clientIp, config.LOGIN_WINDOW, config.LOGIN_MAX_ATTEMPTS);
  if (!limit.ok) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
  }

  const { password } = req.body ?? {};
  if (!config.PASSWORD || password === config.PASSWORD) {
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
    const token = createSession();
    res.cookie('dash_token', token, {
      httpOnly: true,
      sameSite: isSecure ? 'none' : 'strict',
      secure:   isSecure,
      path:     '/',
      maxAge:   config.SESSION_TTL,
    });
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
});

apiRouter.get('/login', (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, 'login.html')));

apiRouter.post('/api/deploy', (req, res) => {
  if (!config.DEPLOY_SECRET) {
    pushLog('⚠️ /api/deploy desativado — configure DEPLOY_WEBHOOK_SECRET no .env', 'warn');
    return res.status(503).json({ error: 'Deploy não configurado' });
  }

  if (!verifyGitHubSignature(req)) {
    pushLog('⚠️ Deploy: assinatura inválida — request rejeitado', 'warn');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.body.ref !== 'refs/heads/main') {
    return res.status(200).json({ ok: true, message: 'Branch ignorada' });
  }

  res.status(200).json({ ok: true, message: 'Deploy agendado' });
  scheduleDeploy();
});

apiRouter.get('/health', (_req, res) => {
  const isHealthy = botManager.status === 'running' || botManager.status === 'qr_wait';
  res.status(isHealthy ? 200 : 503).json({
    status:    botManager.status,
    timestamp: Date.now(),
    uptime:    botManager.getUptime(),
  });
});

// ─── Rotas protegidas (apiAuth a partir daqui) ─────────────────────────────────
// Sub-router montado em /api para que o apiAuth só alcance os endpoints de dados,
// nunca o restante da aplicação (static/SPA).

const api = Router();
api.use(apiAuth);

api.get('/status', (_req, res) => {
  res.json({
    status:     botManager.status,
    uptime:     botManager.getUptime(),
    reconnects: botManager.reconnectCount,
    pid:        botManager.process?.pid ?? null,
    hasQR:      !!botManager.currentQR,
    qr:         botManager.currentQR,
    publicUrl:  tunnelManager.publicUrl,
  });
});

api.get('/logs', (req, res) => res.json(getLogs(req.query)));

api.get('/stats', (_req, res) => {
  const dbPath = path.join(config.ROOT_DIR, 'data', 'luma_metrics.sqlite');
  try {
    if (!fs.existsSync(dbPath)) return res.json({});
    const db   = new Database(dbPath, { readonly: true });
    const rows = db.prepare('SELECT key, count FROM metrics').all();
    db.close();
    const stats = {};
    for (const row of rows) stats[row.key] = row.count;
    res.json(stats);
  } catch (_) {
    res.json({});
  }
});

api.get('/config', (_req, res) => {
  try {
    res.json(readConfig());
  } catch (err) {
    pushLog(`Erro ao ler config: ${err.message}`, 'error');
    res.status(500).json({ error: 'Falha ao ler configuração' });
  }
});

api.put('/config', (req, res) => {
  try {
    writeConfig(req.body?.changes ?? []);
    pushLog('⚙️ Configuração atualizada pelo dashboard', 'info');
    res.json({ ok: true });
  } catch (err) {
    pushLog(`Erro ao salvar config: ${err.message}`, 'error');
    res.status(400).json({ error: err.message });
  }
});

api.get('/users', (_req, res) => {
  try {
    const users = DatabaseService.getAllWaUsers().map((u) => ({
      jid:         u.jid,
      displayName: UserResolver.getDisplayName(u),
      nickname:    u.bot_nickname ?? '',
      pushName:    u.push_name ?? '',
      lastSeen:    u.last_seen_at,
    }));
    res.json(users);
  } catch (_) {
    res.json([]);
  }
});

api.put('/users/:jid/nick', (req, res) => {
  const { jid } = req.params;
  const nickname = String(req.body?.nickname ?? '').trim().slice(0, 60);
  try {
    DatabaseService.setNickname(jid, nickname);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/ranking', (req, res) => {
  const { scope = 'global', jid } = req.query;
  try {
    const rows = scope === 'group' && jid
      ? DatabaseService.getGroupRanking(jid, 20)
      : DatabaseService.getGlobalRanking(20);
    res.json(rows.map((r) => ({
      jid:    r.sender_jid,
      name:   UserResolver.getDisplayName(r.sender_jid),
      count:  r.count,
      lastAt: r.last_at,
    })));
  } catch (_) {
    res.json([]);
  }
});

api.get('/reminders', (_req, res) => {
  try {
    res.json(ReminderService.getPending());
  } catch (_) {
    res.json([]);
  }
});

api.delete('/reminders/:id', (req, res) => {
  try {
    ReminderService.cancel(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function botControl(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const limit = checkRateLimit('botControl', clientIp, config.BOT_CONTROL_WINDOW, config.BOT_CONTROL_MAX);
  if (!limit.ok) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
  }
  next();
}

api.post('/bot/start',   botControl, (_req, res) => res.json(botManager.start()));
api.post('/bot/stop',    botControl, (_req, res) => res.json(botManager.stop()));
api.post('/bot/restart', botControl, (_req, res) => res.json(botManager.restart()));

apiRouter.use('/api', api);
