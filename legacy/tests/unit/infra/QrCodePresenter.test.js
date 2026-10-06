import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../../src/utils/Logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mocka qrcode-terminal como módulo dinâmico disponível.
const mockGenerate = vi.fn();
vi.mock('qrcode-terminal', () => ({
  default: { generate: mockGenerate },
}));

import { presentQrCode } from '../../../src/infra/QrCodePresenter.js';

// ── Testes ─────────────────────────────────────────────────────────────────────

describe('presentQrCode — exibição do QR Code', () => {
  let stdoutSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('escreve o sinal [LUMA_QR]:... no stdout', async () => {
    await presentQrCode('qrdata123', { attempt: 1, maxAttempts: 5 });

    const calls = stdoutSpy.mock.calls.map(c => c[0]);
    const qrLine = calls.find(s => s.startsWith('[LUMA_QR]:'));
    expect(qrLine).toBeDefined();
    expect(qrLine).toContain('qrdata123');
  });

  it('chama qrcode.generate com o QR code', async () => {
    await presentQrCode('meuqrcode', { attempt: 2, maxAttempts: 5 });
    expect(mockGenerate).toHaveBeenCalledWith('meuqrcode', { small: true });
  });

  it('não lança erro mesmo se qrcode-terminal não estiver disponível', async () => {
    // Simula ausência do módulo fazendo o mock retornar null
    // (o módulo já está mockado, então testamos indiretamente a robustez do try/catch)
    vi.doMock('qrcode-terminal', () => { throw new Error('module not found'); });

    // Mesmo que o import dinâmico falhe internamente, presentQrCode não deve lançar
    await expect(presentQrCode('qr', { attempt: 1, maxAttempts: 3 })).resolves.not.toThrow();
  });

  it('formata corretamente a mensagem de tentativa no log', async () => {
    const { Logger } = await import('../../../src/utils/Logger.js');
    await presentQrCode('qr', { attempt: 3, maxAttempts: 5 });

    const infoCalls = Logger.info.mock.calls.map(c => c[0]);
    expect(infoCalls.some(msg => msg.includes('3/5'))).toBe(true);
  });
});
