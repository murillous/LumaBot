import { describe, it, expect, vi } from 'vitest';

/**
 * Testes de caracterização das funções puras do MessageHandler.
 *
 * Apenas as funções determinísticas são testadas aqui:
 * - detectCommand: parsing de comandos com prefixo
 * - extractUrl: extração de URLs de texto
 * - getMessageType: detecção de tipo de mídia
 *
 * O fluxo completo (process, handleLumaCommand) pertence aos testes
 * de integração, pois envolve socket real + IA.
 */

// Isola as dependências com efeitos colaterais do MessageHandler
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

import { MessageHandler } from '../../src/handlers/MessageHandler.js';
import { COMMANDS } from '../../src/config/constants.js';

describe('MessageHandler.detectCommand — detecção de comandos', () => {
  it('detecta !sticker', () => {
    expect(MessageHandler.detectCommand('!sticker')).toBe(COMMANDS.STICKER);
  });

  it('detecta !s (alias do sticker)', () => {
    expect(MessageHandler.detectCommand('!s')).toBe(COMMANDS.STICKER);
  });

  it('detecta !image', () => {
    expect(MessageHandler.detectCommand('!image')).toBe(COMMANDS.IMAGE);
  });

  it('detecta !i (alias do image)', () => {
    expect(MessageHandler.detectCommand('!i')).toBe(COMMANDS.IMAGE);
  });

  it('detecta !gif', () => {
    expect(MessageHandler.detectCommand('!gif')).toBe(COMMANDS.GIF);
  });

  it('detecta !g (alias do gif)', () => {
    expect(MessageHandler.detectCommand('!g')).toBe(COMMANDS.GIF);
  });

  it('detecta !help', () => {
    expect(MessageHandler.detectCommand('!help')).toBe(COMMANDS.HELP);
  });

  it('detecta !menu como alias do help', () => {
    expect(MessageHandler.detectCommand('!menu')).toBe(COMMANDS.HELP);
  });

  it('detecta !persona', () => {
    expect(MessageHandler.detectCommand('!persona')).toBe(COMMANDS.PERSONA);
  });

  it('detecta !download com URL', () => {
    expect(MessageHandler.detectCommand('!download https://x.com/algo')).toBe(COMMANDS.DOWNLOAD);
  });

  it('detecta !d (alias do download)', () => {
    expect(MessageHandler.detectCommand('!d https://x.com/algo')).toBe(COMMANDS.DOWNLOAD);
  });

  it('detecta @everyone', () => {
    expect(MessageHandler.detectCommand('@everyone')).toBe(COMMANDS.EVERYONE);
  });

  it('detecta @todos (alias do everyone)', () => {
    expect(MessageHandler.detectCommand('@todos')).toBe(COMMANDS.EVERYONE);
  });

  it('detecta !luma stats', () => {
    expect(MessageHandler.detectCommand('!luma stats')).toBe(COMMANDS.LUMA_STATS);
  });

  it('detecta !ls (alias do luma stats)', () => {
    expect(MessageHandler.detectCommand('!ls')).toBe(COMMANDS.LUMA_STATS);
  });

  it('detecta !luma clear', () => {
    expect(MessageHandler.detectCommand('!luma clear')).toBe(COMMANDS.LUMA_CLEAR);
  });

  it('detecta !lc (alias do luma clear)', () => {
    expect(MessageHandler.detectCommand('!lc')).toBe(COMMANDS.LUMA_CLEAR);
  });

  it('detecta !clear (alias alternativo do luma clear)', () => {
    expect(MessageHandler.detectCommand('!clear')).toBe(COMMANDS.LUMA_CLEAR_ALT);
  });

  it('detecta !meunumero', () => {
    expect(MessageHandler.detectCommand('!meunumero')).toBe(COMMANDS.MY_NUMBER);
  });

  it('é case insensitive — !STICKER detecta como sticker', () => {
    expect(MessageHandler.detectCommand('!STICKER')).toBe(COMMANDS.STICKER);
  });

  it('retorna null para texto sem comando', () => {
    expect(MessageHandler.detectCommand('oi tudo bem?')).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(MessageHandler.detectCommand('')).toBeNull();
  });

  it('retorna null para mensagem da Luma sem prefixo de comando', () => {
    expect(MessageHandler.detectCommand('luma me explica isso')).toBeNull();
  });
});

describe('MessageHandler.extractUrl — extração de URLs', () => {
  it('extrai URL https de texto simples', () => {
    const url = MessageHandler.extractUrl('!download https://x.com/user/status/123');
    expect(url).toBe('https://x.com/user/status/123');
  });

  it('extrai URL http também', () => {
    const url = MessageHandler.extractUrl('veja em http://exemplo.com/pagina');
    expect(url).toBe('http://exemplo.com/pagina');
  });

  it('extrai a primeira URL quando há múltiplas', () => {
    const url = MessageHandler.extractUrl('veja https://primeiro.com e https://segundo.com');
    expect(url).toBe('https://primeiro.com');
  });

  it('retorna null para texto sem URL', () => {
    expect(MessageHandler.extractUrl('texto sem link nenhum')).toBeNull();
  });

  it('retorna null para null', () => {
    expect(MessageHandler.extractUrl(null)).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(MessageHandler.extractUrl('')).toBeNull();
  });

  it('extrai URL do Instagram corretamente', () => {
    const url = MessageHandler.extractUrl('!d https://instagram.com/reel/abc123/');
    expect(url).toBe('https://instagram.com/reel/abc123/');
  });
});

describe('MessageHandler.getMessageType — detecção de tipo de mídia', () => {
  it('retorna "image" para imageMessage sem gif', () => {
    const msg = { message: { imageMessage: { mimetype: 'image/jpeg' } } };
    expect(MessageHandler.getMessageType(msg)).toBe('image');
  });

  it('retorna "gif" para imageMessage com mimetype gif', () => {
    const msg = { message: { imageMessage: { mimetype: 'image/gif' } } };
    expect(MessageHandler.getMessageType(msg)).toBe('gif');
  });

  it('retorna "video" para videoMessage sem gifPlayback', () => {
    const msg = { message: { videoMessage: { gifPlayback: false } } };
    expect(MessageHandler.getMessageType(msg)).toBe('video');
  });

  it('retorna "gif" para videoMessage com gifPlayback true', () => {
    const msg = { message: { videoMessage: { gifPlayback: true } } };
    expect(MessageHandler.getMessageType(msg)).toBe('gif');
  });

  it('retorna "image" como fallback para tipos desconhecidos', () => {
    const msg = { message: { stickerMessage: {} } };
    expect(MessageHandler.getMessageType(msg)).toBe('image');
  });
});
