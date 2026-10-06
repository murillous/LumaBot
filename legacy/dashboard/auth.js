import crypto from 'crypto';
import path from 'path';
import { config } from './config.js';

/**
 * Sessões, rate-limit genérico e middlewares de autenticação.
 *
 * Tudo em memória: sessões por token e rate-limits isolados por nome de store
 * (sem vazamento — limpeza periódica remove registros expirados).
 */

const sessions = new Map();        // token -> { createdAt }
const rateStores = new Map();      // storeName -> Map(key -> { count, windowStart, windowMs })

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

export function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > config.SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** Rate-limit genérico em memória, com stores isoladas por nome. */
export function checkRateLimit(storeName, key, windowMs, max) {
  let store = rateStores.get(storeName);
  if (!store) {
    store = new Map();
    rateStores.set(storeName, store);
  }

  const now = Date.now();
  const record = store.get(key);
  if (!record) {
    store.set(key, { count: 1, windowStart: now, windowMs });
    return { ok: true };
  }
  if (now - record.windowStart > windowMs) {
    record.count = 1;
    record.windowStart = now;
    record.windowMs = windowMs;
    return { ok: true };
  }
  record.count++;
  if (record.count > max) {
    return { ok: false, retryAfter: Math.ceil((record.windowStart + windowMs - now) / 1000) };
  }
  return { ok: true };
}

function cleanup() {
  const now = Date.now();
  for (const store of rateStores.values()) {
    for (const [key, record] of store) {
      if (now - record.windowStart > record.windowMs) store.delete(key);
    }
  }
  for (const [token, session] of sessions) {
    if (now - session.createdAt > config.SESSION_TTL) sessions.delete(token);
  }
}
setInterval(cleanup, 60000);

// ─── Middlewares ────────────────────────────────────────────────────────────

function getToken(req) {
  const fromCookie = req.headers.cookie?.match(/(?:^|;\s*)dash_token=([^;]+)/)?.[1];
  return req.headers['x-dashboard-token']
    || (fromCookie ? decodeURIComponent(fromCookie) : '')
    || '';
}

// Assets estáticos públicos — necessários para a página de login renderizar com estilo.
const PUBLIC_STATIC = new Set(['/styles.css', '/favicon.ico', '/barba-init.js']);

/** Autenticação dos endpoints JSON — sempre 401 quando não autorizado. */
export function apiAuth(req, res, next) {
  if (!config.PASSWORD) return next();
  if (isValidSession(getToken(req))) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

/** Autenticação das páginas HTML — redireciona para login quando não autorizado. */
export function webAuth(req, res, next) {
  if (!config.PASSWORD) return next();
  if (PUBLIC_STATIC.has(req.path)) return next();
  if (isValidSession(getToken(req))) return next();
  if (req.headers.accept?.includes('text/html')) {
    return res.sendFile(path.join(config.PUBLIC_DIR, 'login.html'));
  }
  return res.status(401).json({ error: 'Unauthorized' });
}
