// ─── Autenticação ─────────────────────────────────────────────────────────────

const TOKEN = localStorage.getItem('dash_token') ?? '';

function authHeader() {
  return TOKEN ? { 'x-dashboard-token': TOKEN } : {};
}

function tokenParam() {
  return TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : '';
}

// ─── API ──────────────────────────────────────────────────────────────────────

const api = {
  async _post(path) {
    try {
      const res  = await fetch(path, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
      });
      if (res.status === 401) return location.href = '/login';
      return res.json();
    } catch (e) {
      dashboard.pushLog(`Erro de rede: ${e.message}`, 'error');
    }
  },
  start()   { return this._post('/api/bot/start');   },
  stop()    { return this._post('/api/bot/stop');     },
  restart() { return this._post('/api/bot/restart'); },
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

class Dashboard {
  constructor() {
    this.logs        = [];          // todos os logs recebidos
    this.maxLogs     = 500;
    this.activeLevel = 'all';       // filtro de nível ativo
    this.searchQuery = '';          // texto do filtro de busca
    this.autoScroll  = true;        // rola para o fim automaticamente
    this.status      = 'stopped';
    this.uptimeStart = null;
    this.reconnects  = 0;
    this.pid         = null;

    this._wsRetries = 0;
    this._bindFilterButtons();
    this._startClock();
    this._startUptimeTicker();
    this._connectWS();
    this._fetchStats();
    setInterval(() => this._fetchStats(), 30000);
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url   = `${proto}//${location.host}/ws${tokenParam()}`;

    this._ws = new WebSocket(url);

    this._ws.onopen = () => {
      this._wsRetries = 0;
      this._setLiveBadge(true);
    };

    this._ws.onmessage = (e) => {
      try {
        this._handleEvent(JSON.parse(e.data));
      } catch (_) {}
    };

    this._ws.onclose = (ev) => {
      this._setLiveBadge(false);
      // 4001 = não autorizado, não tenta reconectar
      if (ev.code === 4001) { location.href = '/login'; return; }
      // Reconecta com backoff simples
      const delay = Math.min((this._wsRetries++ || 1) * 2000, 15000);
      setTimeout(() => this._connectWS(), delay);
    };

    this._ws.onerror = () => {
      this._setLiveBadge(false);
    };
  }

  _handleEvent(ev) {
    switch (ev.type) {
      case 'init':
        this._applyStatus(ev.status);
        if (ev.qr)        this._showQR(ev.qr);
        if (ev.publicUrl) this._setTunnelUrl(ev.publicUrl);
        if (ev.logs) {
          this.logs = [];
          ev.logs.forEach(l => this._addLog(l.message, l.level, l.timestamp, false));
          this._renderLogs();
        }
        break;

      case 'log':
        this._addLog(ev.message, ev.level, ev.timestamp);
        break;

      case 'status':
        this._applyStatus(ev.status);
        break;

      case 'qr':
        this._showQR(ev.dataUrl);
        break;

      case 'qr_clear':
        this._hideQR();
        break;

      case 'tunnel_url':
        this._setTunnelUrl(ev.url);
        break;
    }
  }

  // ── Estado do bot ─────────────────────────────────────────────────────────

  _applyStatus(status) {
    this.status = status;

    const dot   = document.getElementById('statusDot');
    const badge = document.getElementById('statusBadge');
    const metric = document.getElementById('metricStatus');

    const MAP = {
      stopped:    { cls: 'inactive', label: '● OFFLINE',    color: 'red'    },
      starting:   { cls: 'blink',    label: '● STARTING',   color: 'yellow' },
      connecting: { cls: 'blink',    label: '● CONNECTING', color: 'yellow' },
      qr_wait:    { cls: 'blink',    label: '● QR WAIT',    color: 'yellow' },
      running:    { cls: 'active',   label: '● ONLINE',     color: 'green'  },
      error:      { cls: 'inactive', label: '● ERROR',      color: 'red'    },
    };

    const cfg = MAP[status] ?? MAP.stopped;
    dot.className   = `status-indicator ${cfg.cls}`;
    badge.textContent = cfg.label;
    badge.className   = `status-badge status-${cfg.color}`;
    metric.textContent = status.toUpperCase();
    metric.className   = `metric-value status-${cfg.color}`;

    // Atualiza botões
    const running = status === 'running' || status === 'connecting' || status === 'starting';
    document.getElementById('btnStart').disabled   = running;
    document.getElementById('btnStop').disabled    = !running;
    document.getElementById('btnRestart').disabled = !botProcess && status === 'stopped';

    // Fecha QR se conectou
    if (status === 'running') this._hideQR();

    // Registra início de uptime
    if (status === 'running' && !this.uptimeStart) this.uptimeStart = Date.now();
    if (status === 'stopped' || status === 'error') this.uptimeStart = null;
  }

  updateServerInfo(data) {
    this.reconnects = data.reconnects ?? this.reconnects;
    this.pid        = data.pid ?? null;
    document.getElementById('metricReconnects').textContent = this.reconnects;
    document.getElementById('metricPid').textContent        = this.pid ?? '—';
    document.getElementById('headerPid').textContent        = this.pid ? `PID ${this.pid}` : '';
  }

  // ── Tunnel URL ────────────────────────────────────────────────────────────

  _setTunnelUrl(url) {
    const section = document.getElementById('tunnelSection');
    const link    = document.getElementById('tunnelUrl');
    if (url) {
      link.href        = url;
      link.textContent = url;
      section.style.display = '';
    } else {
      section.style.display = 'none';
    }
  }

  copyTunnelUrl() {
    const url = document.getElementById('tunnelUrl').href;
    if (!url || url === '#') return;
    navigator.clipboard.writeText(url).then(() => {
      this.pushLog(`📋 URL copiada: ${url}`, 'success');
    });
  }

  // ── QR Code ───────────────────────────────────────────────────────────────

  _showQR(dataUrl) {
    document.getElementById('qrImage').src = dataUrl;
    document.getElementById('qrOverlay').classList.add('visible');
  }

  _hideQR() {
    document.getElementById('qrOverlay').classList.remove('visible');
  }

  // ── Logs ──────────────────────────────────────────────────────────────────

  _addLog(message, level = 'info', timestamp = Date.now(), render = true) {
    this.logs.push({ message, level, timestamp });
    if (this.logs.length > this.maxLogs) this.logs.shift();
    if (render) this._appendLogEntry({ message, level, timestamp });
  }

  pushLog(message, level = 'info') {
    this._addLog(message, level, Date.now(), true);
  }

  _matchesFilter(log) {
    if (this.activeLevel !== 'all' && log.level !== this.activeLevel) return false;
    if (this.searchQuery) {
      return log.message.toLowerCase().includes(this.searchQuery);
    }
    return true;
  }

  _renderLogs() {
    const container = document.getElementById('logContainer');
    const filtered  = this.logs.filter(l => this._matchesFilter(l));

    if (!filtered.length) {
      container.innerHTML = '<div class="log-empty">» Nenhum log neste filtro</div>';
      return;
    }

    container.innerHTML = filtered.map(l => this._logHTML(l)).join('');
    if (this.autoScroll) container.scrollTop = container.scrollHeight;
  }

  _appendLogEntry(log) {
    if (!this._matchesFilter(log)) return;
    const container = document.getElementById('logContainer');

    // Remove estado vazio
    const empty = container.querySelector('.log-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.innerHTML = this._logHTML(log);
    container.appendChild(div.firstChild);

    // Limita DOM a 300 entradas visíveis para performance
    while (container.children.length > 300) {
      container.removeChild(container.firstChild);
    }

    if (this.autoScroll) container.scrollTop = container.scrollHeight;
  }

  _logHTML(log) {
    const time = new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour12: false });
    const msg  = this._escape(log.message);
    const lvl  = log.level.toUpperCase();
    return `<div class="log-entry log-${log.level}">` +
           `<span class="log-time">[${time}]</span>` +
           `<span class="log-level">${lvl}</span>` +
           `<span class="log-msg">${msg}</span>` +
           `</div>`;
  }

  clearLogs() {
    this.logs = [];
    document.getElementById('logContainer').innerHTML =
      '<div class="log-empty">» Logs limpos</div>';
  }

  onSearch(value) {
    this.searchQuery = value.trim().toLowerCase();
    this._renderLogs();
  }

  // ── Filtros ───────────────────────────────────────────────────────────────

  _bindFilterButtons() {
    document.getElementById('logFilters').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-level]');
      if (!btn) return;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.activeLevel = btn.dataset.level;
      this._renderLogs();
    });

    // Detecta se o usuário rolou manualmente para cima → desativa auto-scroll
    document.getElementById('logContainer').addEventListener('scroll', (e) => {
      const el = e.target;
      this.autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
    });
  }

  // ── Relógio e uptime ──────────────────────────────────────────────────────

  _startClock() {
    const tick = () => {
      document.getElementById('headerTime').textContent =
        new Date().toLocaleTimeString('pt-BR', { hour12: false });
    };
    tick();
    setInterval(tick, 1000);
  }

  _startUptimeTicker() {
    setInterval(() => {
      const el = document.getElementById('metricUptime');
      if (!this.uptimeStart) { el.textContent = '00:00:00'; return; }
      const s  = Math.floor((Date.now() - this.uptimeStart) / 1000);
      const h  = String(Math.floor(s / 3600)).padStart(2, '0');
      const m  = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      el.textContent = `${h}:${m}:${ss}`;
    }, 1000);
  }

  // ── Estatísticas ──────────────────────────────────────────────────────────

  async _fetchStats() {
    try {
      const res  = await fetch('/api/status', { headers: authHeader() });
      if (!res.ok) return;
      const data = await res.json();
      this.updateServerInfo(data);
      if (data.status && data.status !== this.status) this._applyStatus(data.status);
      if (data.qr && !document.getElementById('qrOverlay').classList.contains('visible')) {
        this._showQR(data.qr);
      }
    } catch (_) {}

    try {
      const res  = await fetch('/api/stats', { headers: authHeader() });
      if (!res.ok) return;
      const s = await res.json();
      const set = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.textContent = s[key] ?? '0';
      };
      set('sAI',       'ai_responses');
      set('sStickers', 'stickers_created');
      set('sImages',   'images_created');
      set('sGifs',     'gifs_created');
      set('sVideos',   'videos_downloaded');
      set('sTotal',    'total_messages');
    } catch (_) {}
  }

  // ── Live badge ────────────────────────────────────────────────────────────

  _setLiveBadge(connected) {
    const el = document.getElementById('liveBadge');
    el.textContent = connected ? '◉ LIVE' : '○ OFFLINE';
    el.className   = connected ? 'live-badge' : 'live-badge disconnected';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _escape(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// Variável usada nos botões do HTML
let botProcess = false; // placeholder para lógica de disable

document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new Dashboard();
  window.api       = api;
});
