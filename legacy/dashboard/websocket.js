import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { isValidSession } from './auth.js';
import { setBroadcast, getLogs } from './logger.js';
import { botManager } from './botManager.js';
import { tunnelManager } from './tunnelManager.js';

/**
 * Configura o WebSocket server: autentica a conexão, envia o estado inicial e
 * mantém keepalive. Liga o broadcast aos módulos de logger/bot/tunnel para que
 * logs, status, QR e URL do tunnel cheguem aos clientes em tempo real.
 */
export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  function broadcast(event) {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(data); } catch (_) { /* socket fechando */ }
      }
    }
  }

  setBroadcast(broadcast);
  botManager.setOnStateChange(broadcast);
  tunnelManager.setOnUrlChange(broadcast);

  wss.on('connection', (ws, req) => {
    // Autenticação: cookie httpOnly tem prioridade; query param ?token= como fallback
    // para ambientes onde proxies/tunnels não repassam Cookie no upgrade WebSocket.
    const cookieHeader = req.headers.cookie || '';
    const cookieMatch  = cookieHeader.match(/(?:^|;\s*)dash_token=([^;]+)/);
    const cookieToken  = cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';

    const reqUrl     = new URL(req.url, 'http://localhost');
    const queryToken = reqUrl.searchParams.get('token') || '';

    const token = cookieToken || queryToken;

    if (config.PASSWORD && !isValidSession(token)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Envia estado completo imediatamente.
    ws.send(JSON.stringify({
      type:      'init',
      status:    botManager.status,
      qr:        botManager.currentQR,
      publicUrl: tunnelManager.publicUrl,
      logs:      getLogs({ limit: 150 }),
    }));

    clients.add(ws);

    // Keepalive ping a cada 25s.
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 25000);

    ws.on('close', () => { clearInterval(ping); clients.delete(ws); });
    ws.on('error', () => { clearInterval(ping); clients.delete(ws); });
  });

  return wss;
}
