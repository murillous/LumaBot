import { spawn } from 'child_process';
import QRCode from 'qrcode';
import { config } from './config.js';
import { pushLog } from './logger.js';

/**
 * Gerencia o processo filho do bot: spawn, parsing de stdout (sinais
 * [LUMA_QR]: e [LUMA_STATUS]:), QR Code e estado.
 *
 * Mudanças de estado (status/QR) são notificadas via onStateChange, injetado
 * pelo módulo de WebSocket para fazer broadcast.
 */
class BotManager {
  constructor() {
    this.process = null;
    this.status = 'stopped'; // stopped | starting | connecting | qr_wait | running | error
    this.startTime = null;
    this.reconnectCount = 0;
    this.currentQR = null;
    this.onStateChange = () => {};
  }

  setOnStateChange(fn) {
    this.onStateChange = fn;
  }

  setStatus(status) {
    this.status = status;
    this.onStateChange({ type: 'status', status });
  }

  getUptime() {
    return this.startTime ? Date.now() - this.startTime : 0;
  }

  start() {
    if (this.process) return { ok: false, error: 'Bot já está rodando' };

    this.setStatus('starting');
    this.currentQR = null;
    this.startTime = Date.now();
    pushLog('▶ Iniciando processo do bot...', 'info');

    this.process = spawn('node', ['index.js'], {
      cwd:   config.ROOT_DIR,
      env:   { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';

    this.process.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf   = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith('[LUMA_QR]:')) {
          this.handleQR(line.slice('[LUMA_QR]:'.length).trim());
          continue;
        }
        if (line.startsWith('[LUMA_STATUS]:')) {
          this.handleStatusSignal(line.slice('[LUMA_STATUS]:'.length).trim());
          continue;
        }

        pushLog(line);
      }
    });

    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) pushLog(text, 'error');
    });

    this.process.on('close', (code) => {
      this.process   = null;
      this.startTime = null;
      this.currentQR = null;
      this.reconnectCount++;
      pushLog(`Processo encerrado (código ${code ?? '?'})`, code === 0 ? 'info' : 'error');
      this.setStatus('stopped');
    });

    this.process.on('error', (err) => {
      pushLog(`Erro ao iniciar processo: ${err.message}`, 'error');
      this.setStatus('error');
      this.process = null;
    });

    return { ok: true };
  }

  stop() {
    if (!this.process) return { ok: false, error: 'Bot não está rodando' };
    pushLog('⏹ Encerrando bot...', 'warn');
    this.process.kill('SIGTERM');
    return { ok: true };
  }

  restart() {
    pushLog('🔄 Reiniciando bot...', 'warn');
    if (this.process) { this.process.kill('SIGTERM'); this.process = null; }
    setTimeout(() => this.start(), 1500);
    return { ok: true };
  }

  async handleQR(qrRaw) {
    try {
      const dataUrl = await QRCode.toDataURL(qrRaw, {
        margin: 1,
        width:  256,
        color:  { dark: '#00ff00', light: '#0d1117' },
      });
      this.currentQR = dataUrl;
      this.setStatus('qr_wait');
      this.onStateChange({ type: 'qr', dataUrl });
      pushLog('📱 QR Code gerado — aguardando escaneamento', 'warn');
    } catch (err) {
      pushLog(`Erro ao renderizar QR: ${err.message}`, 'error');
    }
  }

  handleStatusSignal(signal) {
    switch (signal) {
      case 'connected':
        this.currentQR = null;
        this.startTime = this.startTime ?? Date.now();
        this.onStateChange({ type: 'qr_clear' });
        this.setStatus('running');
        break;
      case 'connecting':
        this.setStatus('connecting');
        break;
      case 'disconnected':
        this.currentQR = null;
        this.setStatus('stopped');
        break;
    }
  }

  // Encerra o processo filho quando o dashboard sai (inclui o restart de deploy),
  // para não deixar uma segunda sessão do bot órfã.
  shutdown() {
    try { this.process?.kill('SIGTERM'); } catch { /* já encerrado */ }
  }
}

export const botManager = new BotManager();
