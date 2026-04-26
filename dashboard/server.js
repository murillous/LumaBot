import express    from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn, execSync } from 'child_process';
import crypto        from 'crypto';
import { fileURLToPath } from 'url';
import path          from 'path';
import fs           from 'fs';
import QRCode        from 'qrcode';
import dotenv        from 'dotenv';
import Database      from 'better-sqlite3';

dotenv.config();

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR   = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'src', 'public');

const PORT           = parseInt(process.env.DASHBOARD_PORT  || '3000', 10);
const PASSWORD       = process.env.DASHBOARD_PASSWORD       || '';
const TUNNEL_ENABLED = process.env.CLOUDFLARE_TUNNEL === 'true';
const DEPLOY_SECRET  = process.env.DEPLOY_WEBHOOK_SECRET    || '';

let deployDebounceTimer = null;
const DEPLOY_DEBOUNCE_MS = 5000;

// ─── Estado global ────────────────────────────────────────────────────────────

let botProcess   = null;
let botStatus    = 'stopped'; // stopped | starting | connecting | qr_wait | running | error
let botStartTime = null;
let reconnectCount = 0;
let currentQR    = null;
let publicUrl    = null;

const logBuffer = [];
const MAX_LOGS  = 500;
const wsClients = new Set();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLevel(line) {
  if (/❌|error|Error/.test(line))        return 'error';
  if (/⚠️|warn|Warn/.test(line))         return 'warn';
  if (/✅|Conectado|sucesso/i.test(line)) return 'success';
  return 'info';
}

function pushLog(message, level) {
  const entry = {
    timestamp: Date.now(),
    level:     level ?? parseLevel(message),
    message:   message.trim(),
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  broadcast({ type: 'log', ...entry });
}

function broadcast(event) {
  const data = JSON.stringify(event);
  for (const ws of wsClients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); } catch (_) {}
    }
  }
}

function setStatus(status) {
  botStatus = status;
  broadcast({ type: 'status', status });
}

function getUptime() {
  return botStartTime ? Date.now() - botStartTime : 0;
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

function startBot() {
  if (botProcess) return { ok: false, error: 'Bot já está rodando' };

  setStatus('starting');
  currentQR    = null;
  botStartTime = Date.now();
  pushLog('▶ Iniciando processo do bot...', 'info');

  botProcess = spawn('node', ['index.js'], {
    cwd:   ROOT_DIR,
    env:   { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';

  botProcess.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf   = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      if (line.startsWith('[LUMA_QR]:')) {
        handleQRSignal(line.slice('[LUMA_QR]:'.length).trim());
        continue;
      }
      if (line.startsWith('[LUMA_STATUS]:')) {
        handleStatusSignal(line.slice('[LUMA_STATUS]:'.length).trim());
        continue;
      }

      pushLog(line);
    }
  });

  botProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) pushLog(text, 'error');
  });

  botProcess.on('close', (code) => {
    botProcess   = null;
    botStartTime = null;
    currentQR    = null;
    reconnectCount++;
    pushLog(`Processo encerrado (código ${code ?? '?'})`, code === 0 ? 'info' : 'error');
    setStatus('stopped');
  });

  botProcess.on('error', (err) => {
    pushLog(`Erro ao iniciar processo: ${err.message}`, 'error');
    setStatus('error');
    botProcess = null;
  });

  return { ok: true };
}

function stopBot() {
  if (!botProcess) return { ok: false, error: 'Bot não está rodando' };
  pushLog('⏹ Encerrando bot...', 'warn');
  botProcess.kill('SIGTERM');
  return { ok: true };
}

function restartBot() {
  pushLog('🔄 Reiniciando bot...', 'warn');
  if (botProcess) { botProcess.kill('SIGTERM'); botProcess = null; }
  setTimeout(startBot, 1500);
  return { ok: true };
}

async function handleQRSignal(qrRaw) {
  try {
    const dataUrl = await QRCode.toDataURL(qrRaw, {
      margin: 1,
      width:  256,
      color:  { dark: '#00ff00', light: '#0d1117' },
    });
    currentQR = dataUrl;
    setStatus('qr_wait');
    broadcast({ type: 'qr', dataUrl });
    pushLog('📱 QR Code gerado — aguardando escaneamento', 'warn');
  } catch (err) {
    pushLog(`Erro ao renderizar QR: ${err.message}`, 'error');
  }
}

function handleStatusSignal(signal) {
  switch (signal) {
    case 'connected':
      currentQR    = null;
      botStartTime = botStartTime ?? Date.now();
      broadcast({ type: 'qr_clear' });
      setStatus('running');
      break;
    case 'connecting':
      setStatus('connecting');
      break;
    case 'disconnected':
      currentQR = null;
      setStatus('stopped');
      break;
  }
}

// ─── Cloudflare Tunnel ────────────────────────────────────────────────────────

let tunnelProcess  = null;
let tunnelRestarts = 0;
const MAX_TUNNEL_RESTARTS = 10;

function startTunnel() {
  if (!TUNNEL_ENABLED || tunnelProcess) return;

  pushLog(`🌐 Iniciando Cloudflare Tunnel... (tentativa ${tunnelRestarts + 1})`, 'info');

  tunnelProcess = spawn(
    'cloudflared',
    ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const onData = (chunk) => {
    const text = chunk.toString();

    for (const line of text.split('\n')) {
      const clean = line.trim();
      if (!clean) continue;
      if (/INF|ERR|WRN/.test(clean)) {
        pushLog(`[cloudflared] ${clean}`, clean.includes('ERR') ? 'error' : clean.includes('WRN') ? 'warn' : 'info');
      }
    }

    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== publicUrl) {
      publicUrl = match[0];
      pushLog(`✅ URL pública: ${publicUrl}`, 'success');
      broadcast({ type: 'tunnel_url', url: publicUrl });
      console.log(`\n🌐 Acesso externo: ${publicUrl}\n`);
    }
  };

  tunnelProcess.stdout.on('data', onData);
  tunnelProcess.stderr.on('data', onData);

  tunnelProcess.on('close', (code) => {
    tunnelProcess = null;
    publicUrl     = null;
    broadcast({ type: 'tunnel_url', url: null });
    pushLog(`Tunnel encerrado (código ${code ?? '?'})`, code === 0 ? 'info' : 'warn');

    if (tunnelRestarts < MAX_TUNNEL_RESTARTS) {
      const delay = Math.min(5000 * ++tunnelRestarts, 60000);
      pushLog(`🔁 Reconectando tunnel em ${delay / 1000}s...`, 'info');
      setTimeout(startTunnel, delay);
    } else {
      pushLog('❌ Tunnel: máximo de tentativas atingido.', 'error');
    }
  });

  tunnelProcess.on('error', (err) => {
    tunnelProcess = null;
    pushLog(err.message.includes('ENOENT')
      ? '❌ cloudflared não encontrado no PATH.'
      : `Erro no tunnel: ${err.message}`, 'error');
  });
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

function verifyGitHubSignature(req) {
  const signature = req.headers['x-hub-signature-256'] || '';
  const expected  = 'sha256=' + crypto
    .createHmac('sha256', DEPLOY_SECRET)
    .update(req.rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function runDeploy() {
  pushLog('🚀 Deploy iniciado (push na main)...', 'info');
  try {
    pushLog('📥 Executando git pull...', 'info');
    execSync('git pull origin main', { cwd: ROOT_DIR, timeout: 30000 });

    const changed = execSync('git diff HEAD~1 HEAD --name-only', { cwd: ROOT_DIR }).toString();

    if (changed.includes('package')) {
      pushLog('📦 Instalando dependências...', 'info');
      execSync('npm install --omit=dev --no-audit', { cwd: ROOT_DIR, timeout: 120000 });
    }

    pushLog('✅ Deploy concluído. Reiniciando bot...', 'success');
    restartBot();
  } catch (error) {
    pushLog(`❌ Deploy falhou: ${error.message}`, 'error');
  }
}

function scheduleDeploy() {
  clearTimeout(deployDebounceTimer);
  deployDebounceTimer = setTimeout(runDeploy, DEPLOY_DEBOUNCE_MS);
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app    = express();
const server = createServer(app);

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

function getToken(req) {
  const fromCookie = req.headers.cookie?.match(/(?:^|;\s*)dash_token=([^;]+)/)?.[1];
  return req.query.token
    || req.headers['x-dashboard-token']
    || (fromCookie ? decodeURIComponent(fromCookie) : '')
    || '';
}

// Assets estáticos públicos — necessários para a página de login renderizar com estilo
const PUBLIC_STATIC = new Set(['/styles.css', '/favicon.ico']);

function authMiddleware(req, res, next) {
  if (!PASSWORD) return next();
  if (PUBLIC_STATIC.has(req.path)) return next();
  if (getToken(req) === PASSWORD) return next();
  if (req.headers.accept?.includes('text/html')) return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  return res.status(401).json({ error: 'Unauthorized' });
}

// Rotas públicas
app.post('/api/login', (req, res) => {
  const { password } = req.body ?? {};
  if (!PASSWORD || password === PASSWORD) {
    // Detecta se a requisição chegou via HTTPS (ex: Cloudflare tunnel)
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
    res.cookie('dash_token', PASSWORD, {
      httpOnly: false,            // precisa ser false para o dashboard.js ler via document.cookie se necessário
      sameSite: isSecure ? 'none' : 'lax',
      secure:   isSecure,        // SameSite=None exige Secure
      path:     '/',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 dias
    });
    res.json({ ok: true, token: PASSWORD });
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
});

app.get('/login', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

app.post('/api/deploy', (req, res) => {
  if (!DEPLOY_SECRET) {
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

app.get('/health', (_req, res) => {
  const isHealthy = botStatus === 'running' || botStatus === 'qr_wait';
  res.status(isHealthy ? 200 : 503).json({
    status: botStatus,
    timestamp: Date.now(),
    uptime: getUptime(),
  });
});

// Rotas protegidas
app.use(authMiddleware);
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.use(express.static(PUBLIC_DIR));

app.get('/api/status', (_req, res) => {
  res.json({ status: botStatus, uptime: getUptime(), reconnects: reconnectCount, pid: botProcess?.pid ?? null, hasQR: !!currentQR, qr: currentQR, publicUrl });
});

app.get('/api/logs', (req, res) => {
  const { level, search, limit = 200 } = req.query;
  let logs = [...logBuffer];
  if (level && level !== 'all') logs = logs.filter(l => l.level === level);
  if (search) { const q = search.toLowerCase(); logs = logs.filter(l => l.message.toLowerCase().includes(q)); }
  res.json(logs.slice(-parseInt(limit)));
});

app.get('/api/stats', (_req, res) => {
  const dbPath = path.join(ROOT_DIR, 'data', 'luma_metrics.sqlite');
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

app.post('/api/bot/start',   (_req, res) => res.json(startBot()));
app.post('/api/bot/stop',    (_req, res) => res.json(stopBot()));
app.post('/api/bot/restart', (_req, res) => res.json(restartBot()));

// ─── WebSocket ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Autenticação via query string (?token=xxx)
  const url   = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token') ?? '';

  if (PASSWORD && token !== PASSWORD) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  // Envia estado completo imediatamente
  ws.send(JSON.stringify({
    type:      'init',
    status:    botStatus,
    qr:        currentQR,
    publicUrl,
    logs:      logBuffer.slice(-150),
  }));

  wsClients.add(ws);

  // Keepalive ping a cada 25s
  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25000);

  ws.on('close', () => { clearInterval(ping); wsClients.delete(ws); });
  ws.on('error', () => { clearInterval(ping); wsClients.delete(ws); });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🖥️  Dashboard disponível em http://localhost:${PORT}`);
  console.log(PASSWORD ? '🔒 Acesso protegido por senha.\n' : '⚠️  Sem senha. Defina DASHBOARD_PASSWORD no .env.\n');
  startBot();
  startTunnel();
});
