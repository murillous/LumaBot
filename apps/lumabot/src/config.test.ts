import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('sem variáveis, usa os padrões: SQLite em data/, pareamento por QR, log em info', () => {
    expect(loadConfig({})).toEqual({
      dbPath: 'data/lumabot.sqlite',
      pairing: 'qr',
      logLevel: 'info',
    });
  });

  it('lê o banco, o telefone de pareamento e o nível de log', () => {
    expect(
      loadConfig({
        LUMABOT_DB: '/var/lib/lumabot/bot.sqlite',
        LUMABOT_PAIRING_PHONE: '5511999999999',
        LUMABOT_LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      dbPath: '/var/lib/lumabot/bot.sqlite',
      pairing: { phone: '5511999999999' },
      logLevel: 'debug',
    });
  });

  it('variável vazia vale como ausente', () => {
    expect(
      loadConfig({ LUMABOT_DB: '', LUMABOT_PAIRING_PHONE: '', LUMABOT_LOG_LEVEL: '' }),
    ).toEqual(loadConfig({}));
  });

  it('nível de log desconhecido lança com o nome da variável', () => {
    expect(() => loadConfig({ LUMABOT_LOG_LEVEL: 'verbose' })).toThrow(/LUMABOT_LOG_LEVEL/);
  });
});
