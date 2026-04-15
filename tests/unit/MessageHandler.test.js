import { describe, it, expect, vi } from 'vitest';

/**
 * Testes de caracterização do MessageHandler.
 *
 * As funções puras detectCommand, extractUrl e getMessageType foram
 * movidas respectivamente para:
 *   - CommandRouter.detect  → tests/unit/core/services/CommandRouter.test.js
 *   - MessageUtils.extractUrl    → tests/unit/utils/MessageUtils.test.js
 *   - MessageUtils.getMessageType → tests/unit/utils/MessageUtils.test.js
 *
 * Este arquivo mantém os testes usando os novos locais para evitar regressão.
 */

vi.mock('../../src/services/AIService.js', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    generateContent: vi.fn(),
    getStats: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../../src/services/Database.js', () => ({
  DatabaseService: {
    incrementMetric: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
  },
}));

vi.mock('../../src/managers/PersonalityManager.js', () => ({
  PersonalityManager: {
    getPersonaConfig: vi.fn().mockReturnValue({ context: '', style: '', traits: [] }),
    getActiveName: vi.fn().mockReturnValue('Luma Pensadora'),
    getList: vi.fn().mockReturnValue([]),
    setPersonality: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../../src/handlers/MediaProcessor.js', () => ({
  MediaProcessor: { downloadMedia: vi.fn() },
}));

vi.mock('../../src/services/VideoDownloader.js', () => ({
  VideoDownloader: { download: vi.fn() },
}));

vi.mock('../../src/processors/VideoConverter.js', () => ({
  VideoConverter: { remuxForMobile: vi.fn() },
}));

vi.mock('../../src/handlers/SpontaneousHandler.js', () => ({
  SpontaneousHandler: { handle: vi.fn(), trackActivity: vi.fn() },
}));

import { COMMANDS } from '../../src/config/constants.js';
import { CommandRouter } from '../../src/core/services/CommandRouter.js';
import { getMessageType, extractUrl } from '../../src/utils/MessageUtils.js';

describe('CommandRouter.detect — detecção de comandos (via MessageHandler.test)', () => {
  it('detecta !sticker', () => {
    expect(CommandRouter.detect('!sticker')).toBe(COMMANDS.STICKER);
  });

  it('detecta !s (alias do sticker)', () => {
    expect(CommandRouter.detect('!s')).toBe(COMMANDS.STICKER);
  });

  it('detecta !image', () => {
    expect(CommandRouter.detect('!image')).toBe(COMMANDS.IMAGE);
  });

  it('detecta !i (alias do image)', () => {
    expect(CommandRouter.detect('!i')).toBe(COMMANDS.IMAGE);
  });

  it('detecta !gif', () => {
    expect(CommandRouter.detect('!gif')).toBe(COMMANDS.GIF);
  });

  it('detecta !g (alias do gif)', () => {
    expect(CommandRouter.detect('!g')).toBe(COMMANDS.GIF);
  });

  it('detecta !help', () => {
    expect(CommandRouter.detect('!help')).toBe(COMMANDS.HELP);
  });

  it('detecta !menu como alias do help', () => {
    expect(CommandRouter.detect('!menu')).toBe(COMMANDS.HELP);
  });

  it('detecta !persona', () => {
    expect(CommandRouter.detect('!persona')).toBe(COMMANDS.PERSONA);
  });

  it('detecta !download com URL', () => {
    expect(CommandRouter.detect('!download https://x.com/algo')).toBe(COMMANDS.DOWNLOAD);
  });

  it('detecta !d (alias do download)', () => {
    expect(CommandRouter.detect('!d https://x.com/algo')).toBe(COMMANDS.DOWNLOAD);
  });

  it('detecta @everyone', () => {
    expect(CommandRouter.detect('@everyone')).toBe(COMMANDS.EVERYONE);
  });

  it('detecta @todos (alias do everyone)', () => {
    expect(CommandRouter.detect('@todos')).toBe(COMMANDS.EVERYONE);
  });

  it('detecta !luma stats', () => {
    expect(CommandRouter.detect('!luma stats')).toBe(COMMANDS.LUMA_STATS);
  });

  it('detecta !ls (alias do luma stats)', () => {
    expect(CommandRouter.detect('!ls')).toBe(COMMANDS.LUMA_STATS);
  });

  it('detecta !luma clear', () => {
    expect(CommandRouter.detect('!luma clear')).toBe(COMMANDS.LUMA_CLEAR);
  });

  it('detecta !lc (alias do luma clear)', () => {
    expect(CommandRouter.detect('!lc')).toBe(COMMANDS.LUMA_CLEAR);
  });

  it('detecta !clear (alias alternativo do luma clear)', () => {
    expect(CommandRouter.detect('!clear')).toBe(COMMANDS.LUMA_CLEAR_ALT);
  });

  it('detecta !meunumero', () => {
    expect(CommandRouter.detect('!meunumero')).toBe(COMMANDS.MY_NUMBER);
  });

  it('é case insensitive — !STICKER detecta como sticker', () => {
    expect(CommandRouter.detect('!STICKER')).toBe(COMMANDS.STICKER);
  });

  it('retorna null para texto sem comando', () => {
    expect(CommandRouter.detect('oi tudo bem?')).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(CommandRouter.detect('')).toBeNull();
  });

  it('retorna null para mensagem da Luma sem prefixo de comando', () => {
    expect(CommandRouter.detect('luma me explica isso')).toBeNull();
  });
});

describe('extractUrl — extração de URLs', () => {
  it('extrai URL https de texto simples', () => {
    expect(extractUrl('!download https://x.com/user/status/123')).toBe('https://x.com/user/status/123');
  });

  it('extrai URL http também', () => {
    expect(extractUrl('veja em http://exemplo.com/pagina')).toBe('http://exemplo.com/pagina');
  });

  it('extrai a primeira URL quando há múltiplas', () => {
    expect(extractUrl('veja https://primeiro.com e https://segundo.com')).toBe('https://primeiro.com');
  });

  it('retorna null para texto sem URL', () => {
    expect(extractUrl('texto sem link nenhum')).toBeNull();
  });

  it('retorna null para null', () => {
    expect(extractUrl(null)).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(extractUrl('')).toBeNull();
  });

  it('extrai URL do Instagram corretamente', () => {
    expect(extractUrl('!d https://instagram.com/reel/abc123/')).toBe('https://instagram.com/reel/abc123/');
  });
});

describe('getMessageType — detecção de tipo de mídia', () => {
  it('retorna "image" para imageMessage sem gif', () => {
    const msg = { message: { imageMessage: { mimetype: 'image/jpeg' } } };
    expect(getMessageType(msg)).toBe('image');
  });

  it('retorna "gif" para imageMessage com mimetype gif', () => {
    const msg = { message: { imageMessage: { mimetype: 'image/gif' } } };
    expect(getMessageType(msg)).toBe('gif');
  });

  it('retorna "video" para videoMessage sem gifPlayback', () => {
    const msg = { message: { videoMessage: { gifPlayback: false } } };
    expect(getMessageType(msg)).toBe('video');
  });

  it('retorna "gif" para videoMessage com gifPlayback true', () => {
    const msg = { message: { videoMessage: { gifPlayback: true } } };
    expect(getMessageType(msg)).toBe('gif');
  });

  it('retorna "image" como fallback para tipos desconhecidos', () => {
    const msg = { message: { stickerMessage: {} } };
    expect(getMessageType(msg)).toBe('image');
  });
});
