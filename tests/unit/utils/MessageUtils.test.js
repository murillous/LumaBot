import { describe, it, expect } from 'vitest';
import { getMessageType, extractUrl } from '../../../src/utils/MessageUtils.js';

describe('getMessageType', () => {
  it('retorna "image" para imageMessage sem GIF', () => {
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

  it('retorna "gif" para videoMessage com gifPlayback', () => {
    const msg = { message: { videoMessage: { gifPlayback: true } } };
    expect(getMessageType(msg)).toBe('gif');
  });

  it('retorna "image" como fallback para tipos desconhecidos', () => {
    const msg = { message: { stickerMessage: {} } };
    expect(getMessageType(msg)).toBe('image');
  });
});

describe('extractUrl', () => {
  it('extrai URL de um texto com URL', () => {
    expect(extractUrl('Confira https://example.com/video')).toBe('https://example.com/video');
  });

  it('extrai apenas a primeira URL quando há múltiplas', () => {
    expect(extractUrl('https://a.com e https://b.com')).toBe('https://a.com');
  });

  it('retorna null para texto sem URL', () => {
    expect(extractUrl('sem url aqui')).toBeNull();
  });

  it('retorna null para null', () => {
    expect(extractUrl(null)).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(extractUrl('')).toBeNull();
  });

  it('extrai URLs com http', () => {
    expect(extractUrl('http://insecure.com')).toBe('http://insecure.com');
  });
});
