import { spawn } from 'child_process';
import fs from 'fs';
import { config } from './config.js';
import { pushLog } from './logger.js';

/**
 * Gerencia o Cloudflare Tunnel (cloudflared).
 *
 * Modo supervisionado (PM2): o tunnel roda como processo irmão (luma-tunnel) e
 * este módulo apenas lê a URL do arquivo gravado por ele. Caso contrário, sobe
 * o cloudflared e reconecta com backoff exponencial.
 *
 * Mudanças de URL são notificadas via onUrlChange (injetado pelo WebSocket).
 */
class TunnelManager {
  constructor() {
    this.process = null;
    this.publicUrl = null;
    this.restarts = 0;
    this.maxRestarts = 10;
    this.onUrlChange = () => {};
  }

  setOnUrlChange(fn) {
    this.onUrlChange = fn;
  }

  readUrlFile() {
    try {
      const url = fs.readFileSync(config.TUNNEL_URL_FILE, 'utf-8').trim();
      if (url && url !== this.publicUrl) {
        this.publicUrl = url;
        pushLog(`🌐 URL do tunnel: ${url}`, 'info');
        this.onUrlChange({ type: 'tunnel_url', url });
        console.log(`\n🌐 Acesso externo: ${url}\n`);
      }
    } catch { /* arquivo ainda não existe — tunnel ainda está subindo */ }
  }

  start() {
    if (!config.TUNNEL_ENABLED || this.process) return;

    // Supervisionado (PM2): só lê a URL do arquivo gravado pelo processo irmão.
    if (config.IS_SUPERVISED) {
      this.readUrlFile();
      try { fs.watch(config.TUNNEL_URL_FILE, () => this.readUrlFile()); } catch { /* arquivo ainda não existe */ }
      return;
    }

    pushLog(`🌐 Iniciando Cloudflare Tunnel... (tentativa ${this.restarts + 1})`, 'info');

    this.process = spawn(
      'cloudflared',
      ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.PORT}`],
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
      if (match && match[0] !== this.publicUrl) {
        this.publicUrl = match[0];
        pushLog(`✅ URL pública: ${this.publicUrl}`, 'success');
        this.onUrlChange({ type: 'tunnel_url', url: this.publicUrl });
        console.log(`\n🌐 Acesso externo: ${this.publicUrl}\n`);
      }
    };

    this.process.stdout.on('data', onData);
    this.process.stderr.on('data', onData);

    this.process.on('close', (code) => {
      this.process   = null;
      this.publicUrl = null;
      this.onUrlChange({ type: 'tunnel_url', url: null });
      pushLog(`Tunnel encerrado (código ${code ?? '?'})`, code === 0 ? 'info' : 'warn');

      if (this.restarts < this.maxRestarts) {
        const delay = Math.min(5000 * ++this.restarts, 60000);
        pushLog(`🔁 Reconectando tunnel em ${delay / 1000}s...`, 'info');
        setTimeout(() => this.start(), delay);
      } else {
        pushLog('❌ Tunnel: máximo de tentativas atingido.', 'error');
      }
    });

    this.process.on('error', (err) => {
      this.process = null;
      pushLog(err.message.includes('ENOENT')
        ? '❌ cloudflared não encontrado no PATH.'
        : `Erro no tunnel: ${err.message}`, 'error');
    });
  }

  shutdown() {
    try { this.process?.kill('SIGTERM'); } catch { /* já encerrado */ }
  }
}

export const tunnelManager = new TunnelManager();
