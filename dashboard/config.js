import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT_DIR   = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'src', 'public');
const WEB_DIR    = path.join(__dirname, 'web');
// App React buildado (Vite). Se existir, tem prioridade sobre o legado em src/public.
const WEB_DIST   = path.join(WEB_DIR, 'dist');
const HAS_WEB_BUILD = fs.existsSync(path.join(WEB_DIST, 'index.html'));
const SERVE_DIR  = HAS_WEB_BUILD ? WEB_DIST : PUBLIC_DIR;

// Indica se o processo roda sob um supervisor (pm2/systemd) que o reinicia
// automaticamente ao sair. Necessário para aplicar mudanças no próprio server.js.
const IS_SUPERVISED = !!(
  process.env.LUMA_SUPERVISED ??
  process.env.pm_id ??
  process.env.PM2_HOME ??
  process.env.INVOCATION_ID
);

/** Constantes, paths e variáveis de ambiente do dashboard. */
export const config = {
  PORT:            parseInt(process.env.DASHBOARD_PORT || '3000', 10),
  PASSWORD:        process.env.DASHBOARD_PASSWORD || '',
  TUNNEL_ENABLED:  process.env.CLOUDFLARE_TUNNEL === 'true',
  TUNNEL_URL_FILE: path.join(ROOT_DIR, 'data', 'tunnel-url.txt'),
  DEPLOY_SECRET:   process.env.DEPLOY_WEBHOOK_SECRET || '',
  IS_SUPERVISED,

  ROOT_DIR,
  PUBLIC_DIR,
  WEB_DIR,
  WEB_DIST,
  HAS_WEB_BUILD,
  SERVE_DIR,

  SESSION_TTL:        7 * 24 * 60 * 60 * 1000, // 7 dias
  LOGIN_WINDOW:       15 * 60 * 1000,          // 15 min
  LOGIN_MAX_ATTEMPTS: 10,
  BOT_CONTROL_WINDOW: 60 * 1000,               // 1 min
  BOT_CONTROL_MAX:    10,
};
