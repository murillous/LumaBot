import { describe, expect, it } from 'vitest';
import { fontconfigRelaunchEnv, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('sem variáveis, usa os padrões: SQLite em data/, pareamento por QR, log em info, dashboard na 3000', () => {
    expect(loadConfig({})).toEqual({
      dbPath: 'data/lumabot.sqlite',
      pairing: 'qr',
      logLevel: 'info',
      dashboard: { port: 3000, hostname: '127.0.0.1' },
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
      dashboard: { port: 3000, hostname: '127.0.0.1' },
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

  it('porta off desliga o dashboard; vazia vale como ausente e liga na 3000', () => {
    expect(loadConfig({ LUMABOT_DASHBOARD_PORT: 'off' })).not.toHaveProperty('dashboard');
    expect(loadConfig({ LUMABOT_DASHBOARD_PORT: '' }).dashboard).toEqual({
      port: 3000,
      hostname: '127.0.0.1',
    });
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

describe('fontconfigRelaunchEnv', () => {
  it('no Windows sem FONTCONFIG_FILE, relança com ele e o resto do ambiente', () => {
    expect(fontconfigRelaunchEnv('C:\\lumabot\\windows.conf', 'win32', { PATH: 'x' })).toEqual({
      PATH: 'x',
      FONTCONFIG_FILE: 'C:\\lumabot\\windows.conf',
    });
  });

  it('não relança fora do Windows nem com a variável já definida', () => {
    expect(fontconfigRelaunchEnv('a.conf', 'linux', {})).toBeUndefined();
    expect(fontconfigRelaunchEnv('a.conf', 'win32', { FONTCONFIG_FILE: 'b.conf' })).toBeUndefined();
  });
});
