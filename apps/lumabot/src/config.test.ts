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

  it('lê o arquivo de cookies do yt-dlp', () => {
    expect(loadConfig({ LUMABOT_YTDLP_COOKIES: '/srv/cookies.txt' }).ytdlpCookies).toBe(
      '/srv/cookies.txt',
    );
    expect(loadConfig({ LUMABOT_YTDLP_COOKIES: '' })).not.toHaveProperty('ytdlpCookies');
  });

  it('sem porta, não há dashboard', () => {
    expect(loadConfig({ LUMABOT_DASHBOARD_PORT: '' })).not.toHaveProperty('dashboard');
  });

  it('com porta, liga o dashboard só no loopback, salvo host explícito', () => {
    expect(loadConfig({ LUMABOT_DASHBOARD_PORT: '3000' }).dashboard).toEqual({
      port: 3000,
      hostname: '127.0.0.1',
    });
    expect(
      loadConfig({ LUMABOT_DASHBOARD_PORT: '8080', LUMABOT_DASHBOARD_HOST: '0.0.0.0' }).dashboard,
    ).toEqual({ port: 8080, hostname: '0.0.0.0' });
  });

  it.each(['abc', '0', '65536', '30.5', '-1'])(
    'porta inválida (%s) lança com o nome da variável',
    (port) => {
      expect(() => loadConfig({ LUMABOT_DASHBOARD_PORT: port })).toThrow(/LUMABOT_DASHBOARD_PORT/);
    },
  );
});
