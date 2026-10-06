import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSaveCreds    = vi.fn();
const mockState        = { creds: {}, keys: {} };
const mockVersion      = [2, 3000, 1];
const mockSocket       = { ev: { on: vi.fn() }, end: vi.fn() };

vi.mock('@whiskeysockets/baileys', () => ({
  makeWASocket:              vi.fn(() => mockSocket),
  useMultiFileAuthState:     vi.fn(() => Promise.resolve({ state: mockState, saveCreds: mockSaveCreds })),
  fetchLatestBaileysVersion: vi.fn(() => Promise.resolve({ version: mockVersion, isLatest: true })),
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({ level: 'silent' })),
}));

import { prepareBaileysSession, createBaileysSocket } from '../../../src/infra/BaileysSocketFactory.js';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';

const CONFIG = {
  AUTH_DIR:       './auth_info',
  TIMEOUT_MS:     60_000,
  KEEPALIVE_MS:   30_000,
};

// ── prepareBaileysSession ──────────────────────────────────────────────────────

describe('prepareBaileysSession — inicialização da sessão', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLatestBaileysVersion.mockResolvedValue({ version: mockVersion, isLatest: true });
    useMultiFileAuthState.mockResolvedValue({ state: mockState, saveCreds: mockSaveCreds });
  });

  it('chama fetchLatestBaileysVersion', async () => {
    await prepareBaileysSession(CONFIG);
    expect(fetchLatestBaileysVersion).toHaveBeenCalledTimes(1);
  });

  it('chama useMultiFileAuthState com AUTH_DIR do config', async () => {
    await prepareBaileysSession(CONFIG);
    expect(useMultiFileAuthState).toHaveBeenCalledWith(CONFIG.AUTH_DIR);
  });

  it('retorna version, isLatest, state e saveCreds', async () => {
    const result = await prepareBaileysSession(CONFIG);

    expect(result.version).toEqual(mockVersion);
    expect(result.isLatest).toBe(true);
    expect(result.state).toBe(mockState);
    expect(result.saveCreds).toBe(mockSaveCreds);
  });
});

// ── createBaileysSocket ────────────────────────────────────────────────────────

describe('createBaileysSocket — criação do socket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeWASocket.mockReturnValue(mockSocket);
  });

  it('retorna o socket criado pelo makeWASocket', () => {
    const sock = createBaileysSocket({
      state:    mockState,
      version:  mockVersion,
      config:   CONFIG,
      logLevel: 'silent',
    });
    expect(sock).toBe(mockSocket);
  });

  it('chama makeWASocket com version, auth e timeout corretos', () => {
    createBaileysSocket({
      state:    mockState,
      version:  mockVersion,
      config:   CONFIG,
      logLevel: 'silent',
    });

    expect(makeWASocket).toHaveBeenCalledTimes(1);
    const [opts] = makeWASocket.mock.calls[0];
    expect(opts.version).toEqual(mockVersion);
    expect(opts.auth).toBe(mockState);
    expect(opts.defaultQueryTimeoutMs).toBe(CONFIG.TIMEOUT_MS);
    expect(opts.connectTimeoutMs).toBe(CONFIG.TIMEOUT_MS);
    expect(opts.keepAliveIntervalMs).toBe(CONFIG.KEEPALIVE_MS);
  });

  it('desabilita printQRInTerminal', () => {
    createBaileysSocket({ state: mockState, version: mockVersion, config: CONFIG, logLevel: 'silent' });
    const [opts] = makeWASocket.mock.calls[0];
    expect(opts.printQRInTerminal).toBe(false);
  });

  it('cria logger pino com o logLevel informado', () => {
    createBaileysSocket({ state: mockState, version: mockVersion, config: CONFIG, logLevel: 'warn' });
    expect(pino).toHaveBeenCalledWith({ level: 'warn' });
  });
});
