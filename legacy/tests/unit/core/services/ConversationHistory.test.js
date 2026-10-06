import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mocka Logger para evitar output nos testes.
vi.mock('../../../../src/utils/Logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mocka LUMA_CONFIG — os testes usam valores injetados, mas o import deve existir.
vi.mock('../../../../src/config/lumaConfig.js', () => ({
  LUMA_CONFIG: {
    TECHNICAL: {
      maxHistory:              10,
      maxHistoryAge:           3_600_000,
      historyCleanupInterval:  60_000,
    },
  },
}));

import { ConversationHistory } from '../../../../src/core/services/ConversationHistory.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Cria instância com intervalo de cleanup desativado (evita leak de timer). */
function makeHistory(opts = {}) {
  return new ConversationHistory({
    maxMessages:       10,
    maxAgeMs:          3_600_000,
    cleanupIntervalMs: 1e9, // 11 dias — nunca dispara nos testes
    ...opts,
  });
}

// ── add ────────────────────────────────────────────────────────────────────────

describe('ConversationHistory.add — inserção de mensagens', () => {
  let history;

  beforeEach(() => { history = makeHistory(); });
  afterEach(()  => { history.destroy(); });

  it('cria entrada para novo JID', () => {
    history.add('a@s.whatsapp.net', 'oi', 'olá', 'User');
    expect(history._store.has('a@s.whatsapp.net')).toBe(true);
  });

  it('armazena linhas "Usuário: msg" e "Luma: resposta"', () => {
    history.add('a@s.whatsapp.net', 'pergunta', 'resposta', 'Ana');
    const data = history._store.get('a@s.whatsapp.net');
    expect(data.messages).toContain('Ana: pergunta');
    expect(data.messages).toContain('Luma: resposta');
  });

  it('acumula múltiplas trocas para o mesmo JID', () => {
    const jid = 'b@s.whatsapp.net';
    history.add(jid, 'msg1', 'resp1', 'U');
    history.add(jid, 'msg2', 'resp2', 'U');

    const data = history._store.get(jid);
    expect(data.messages).toHaveLength(4);
  });

  it('atualiza lastUpdate a cada adição', () => {
    const jid    = 'c@s.whatsapp.net';
    const before = Date.now();
    history.add(jid, 'x', 'y', 'U');
    const after  = Date.now();

    const { lastUpdate } = history._store.get(jid);
    expect(lastUpdate).toBeGreaterThanOrEqual(before);
    expect(lastUpdate).toBeLessThanOrEqual(after);
  });

  it('apara mensagens antigas quando excede maxMessages', () => {
    const h   = makeHistory({ maxMessages: 4 });
    const jid = 'd@s.whatsapp.net';

    h.add(jid, 'm1', 'r1', 'U');
    h.add(jid, 'm2', 'r2', 'U');
    h.add(jid, 'm3', 'r3', 'U'); // 6 linhas — excede 4

    const data = h._store.get(jid);
    expect(data.messages.length).toBeLessThanOrEqual(4);
    // Mensagens mais recentes devem estar presentes
    expect(data.messages).toContain('U: m3');
    expect(data.messages).toContain('Luma: r3');

    h.destroy();
  });
});

// ── getText ────────────────────────────────────────────────────────────────────

describe('ConversationHistory.getText — formatação para prompt', () => {
  let history;

  beforeEach(() => { history = makeHistory(); });
  afterEach(()  => { history.destroy(); });

  it('retorna "Nenhuma conversa anterior." para JID sem histórico', () => {
    expect(history.getText('desconhecido@s.whatsapp.net')).toBe('Nenhuma conversa anterior.');
  });

  it('retorna as mensagens separadas por nova linha', () => {
    const jid = 'e@s.whatsapp.net';
    history.add(jid, 'pergunta', 'resposta', 'Pedro');
    const text = history.getText(jid);

    expect(text).toContain('Pedro: pergunta');
    expect(text).toContain('Luma: resposta');
  });
});

// ── getTurns ─────────────────────────────────────────────────────────────────────

describe('ConversationHistory.getTurns — turnos com papel real', () => {
  let history;

  beforeEach(() => { history = makeHistory(); });
  afterEach(()  => { history.destroy(); });

  it('retorna array vazio para JID sem histórico', () => {
    expect(history.getTurns('desconhecido@s.whatsapp.net')).toEqual([]);
  });

  it('mapeia fala do usuário como role "user" mantendo o rótulo "Nome:"', () => {
    const jid = 'gt1@s.whatsapp.net';
    history.add(jid, 'oi', 'olá', 'Ana');
    const turns = history.getTurns(jid);

    expect(turns[0]).toEqual({ role: 'user', text: 'Ana: oi' });
  });

  it('mapeia resposta da Luma como role "model" sem o prefixo "Luma:"', () => {
    const jid = 'gt2@s.whatsapp.net';
    history.add(jid, 'oi', 'olá', 'Ana');
    const turns = history.getTurns(jid);

    expect(turns[1]).toEqual({ role: 'model', text: 'olá' });
  });

  it('alterna user/model ao longo de várias trocas', () => {
    const jid = 'gt3@s.whatsapp.net';
    history.add(jid, 'm1', 'r1', 'U');
    history.add(jid, 'm2', 'r2', 'U');

    expect(history.getTurns(jid).map((t) => t.role)).toEqual(['user', 'model', 'user', 'model']);
  });

  it('detecta o papel pelo prefixo, permanecendo correto após poda cortar um par', () => {
    const h   = makeHistory({ maxMessages: 3 });
    const jid = 'gt4@s.whatsapp.net';
    h.add(jid, 'm1', 'r1', 'U'); // [U:m1, Luma:r1]
    h.add(jid, 'm2', 'r2', 'U'); // vira 4 linhas -> poda p/ 3: [Luma:r1, U:m2, Luma:r2]

    const turns = h.getTurns(jid);
    // Mesmo começando por uma linha "Luma:", o papel é derivado do prefixo.
    expect(turns[0].role).toBe('model');
    expect(turns.map((t) => t.role)).toEqual(['model', 'user', 'model']);

    h.destroy();
  });
});

// ── clear ──────────────────────────────────────────────────────────────────────

describe('ConversationHistory.clear — remoção de histórico', () => {
  let history;

  beforeEach(() => { history = makeHistory(); });
  afterEach(()  => { history.destroy(); });

  it('remove o JID do store', () => {
    const jid = 'f@s.whatsapp.net';
    history.add(jid, 'x', 'y', 'U');
    expect(history._store.has(jid)).toBe(true);

    history.clear(jid);
    expect(history._store.has(jid)).toBe(false);
  });

  it('não lança erro para JID inexistente', () => {
    expect(() => history.clear('ninguem@s.whatsapp.net')).not.toThrow();
  });
});

// ── size ───────────────────────────────────────────────────────────────────────

describe('ConversationHistory.size — contagem de conversas ativas', () => {
  let history;

  beforeEach(() => { history = makeHistory(); });
  afterEach(()  => { history.destroy(); });

  it('começa em 0', () => {
    expect(history.size).toBe(0);
  });

  it('incrementa ao adicionar JIDs distintos', () => {
    history.add('g1@s.whatsapp.net', 'a', 'b', 'U');
    history.add('g2@s.whatsapp.net', 'a', 'b', 'U');
    expect(history.size).toBe(2);
  });

  it('não incrementa ao adicionar ao mesmo JID', () => {
    const jid = 'h@s.whatsapp.net';
    history.add(jid, 'a', 'b', 'U');
    history.add(jid, 'c', 'd', 'U');
    expect(history.size).toBe(1);
  });

  it('decrementa após clear', () => {
    const jid = 'i@s.whatsapp.net';
    history.add(jid, 'a', 'b', 'U');
    history.clear(jid);
    expect(history.size).toBe(0);
  });
});

// ── cleanup automático ─────────────────────────────────────────────────────────

describe('ConversationHistory._cleanup — expiração de entradas antigas', () => {
  it('remove JIDs cujo lastUpdate excedeu maxAgeMs', () => {
    const history = makeHistory({ maxAgeMs: 100, cleanupIntervalMs: 1e9 });
    const jid = 'j@s.whatsapp.net';

    history.add(jid, 'x', 'y', 'U');
    // Retrocede lastUpdate para simular entrada antiga
    history._store.get(jid).lastUpdate = Date.now() - 200;

    history._cleanup();
    expect(history._store.has(jid)).toBe(false);

    history.destroy();
  });

  it('mantém JIDs ainda dentro da janela de tempo', () => {
    const history = makeHistory({ maxAgeMs: 60_000, cleanupIntervalMs: 1e9 });
    const jid = 'k@s.whatsapp.net';

    history.add(jid, 'x', 'y', 'U');
    history._cleanup();
    expect(history._store.has(jid)).toBe(true);

    history.destroy();
  });
});

// ── destroy ────────────────────────────────────────────────────────────────────

describe('ConversationHistory.destroy — limpeza de recursos', () => {
  it('não lança erro ao chamar destroy', () => {
    const history = makeHistory();
    expect(() => history.destroy()).not.toThrow();
  });
});
