/**
 * Buffer circular de logs do dashboard e broadcast para os WebSockets.
 *
 * O broadcast é injetado pelo módulo de WebSocket (setBroadcast) para evitar
 * acoplamento: este módulo não conhece os clientes, só dispara o callback.
 */

const MAX_LOGS = 500;
const logBuffer = [];

let broadcast = () => {};

/** Injeta a função de broadcast (fornecida pelo módulo de WebSocket). */
export function setBroadcast(fn) {
  broadcast = fn;
}

function parseLevel(line) {
  if (/❌|error|Error/.test(line))        return 'error';
  if (/⚠️|warn|Warn/.test(line))         return 'warn';
  if (/✅|Conectado|sucesso/i.test(line)) return 'success';
  return 'info';
}

/** Adiciona um log ao buffer e o transmite aos clientes conectados. */
export function pushLog(message, level) {
  const entry = {
    timestamp: Date.now(),
    level:     level ?? parseLevel(message),
    message:   message.trim(),
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  broadcast({ type: 'log', ...entry });
}

/** Retorna logs filtrados por nível, busca textual e limite. */
export function getLogs({ level, search, limit = 200 } = {}) {
  let logs = [...logBuffer];
  if (level && level !== 'all') logs = logs.filter((l) => l.level === level);
  if (search) {
    const q = String(search).toLowerCase();
    logs = logs.filter((l) => l.message.toLowerCase().includes(q));
  }
  return logs.slice(-parseInt(limit, 10));
}
