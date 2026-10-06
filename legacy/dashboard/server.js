import express from 'express';
import { createServer } from 'http';
import path from 'path';

import { config } from './config.js';
import { webAuth } from './auth.js';
import { apiRouter } from './routes/api.js';
import { setupWebSocket } from './websocket.js';
import { botManager } from './botManager.js';
import { tunnelManager } from './tunnelManager.js';

const app    = express();
const server = createServer(app);

// Headers de segurança (helmet-like)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:;");
  next();
});

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
  limit: '10kb',
}));

app.use(apiRouter);

// Servir a aplicação.
// Com build React presente, os assets são públicos (a UI cuida do login via API).
// Sem build, mantém o dashboard legado (vanilla) protegido pelo webAuth.
if (config.HAS_WEB_BUILD) {
  app.use(express.static(config.WEB_DIST));
  // SPA fallback: qualquer GET fora de /api serve o index.html do app React.
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.WEB_DIST, 'index.html')));
} else {
  app.use(webAuth);
  app.use(express.static(config.PUBLIC_DIR));
  app.get('/', webAuth, (_req, res) => res.sendFile(path.join(config.PUBLIC_DIR, 'dashboard.html')));
}

setupWebSocket(server);

// Encerra os processos filhos (bot e, quando não supervisionado, o tunnel) ao sair —
// incluindo o restart de deploy — para não deixar sessões órfãs.
function shutdown() {
  botManager.shutdown();
  if (!config.IS_SUPERVISED) tunnelManager.shutdown();
}
process.on('exit', shutdown);
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('SIGINT',  () => { shutdown(); process.exit(0); });

server.listen(config.PORT, () => {
  console.log(`\n🖥️  Dashboard disponível em http://localhost:${config.PORT}`);
  console.log(config.PASSWORD ? '🔒 Acesso protegido por senha.\n' : '⚠️  Sem senha. Defina DASHBOARD_PASSWORD no .env.\n');
  botManager.start();
  tunnelManager.start();
});
