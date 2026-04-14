import { describe, it, expect, vi } from 'vitest';

/**
 * Testes de caracterização do VideoDownloader.
 *
 * Foco em detectVideoUrl — a única função pura do serviço.
 * O método download() envolve I/O real (yt-dlp) e pertence a
 * testes de integração com mocks de sistema de arquivos.
 */

// Mocka fs e child_process para evitar qualquer I/O real
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ size: 1024 }),
    writeFileSync: vi.fn(),
    chmodSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ size: 1024 }),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { VideoDownloader } from '../../src/services/VideoDownloader.js';

describe('VideoDownloader.detectVideoUrl — URLs suportadas', () => {
  it('detecta URL do Twitter/X (x.com)', () => {
    const url = VideoDownloader.detectVideoUrl('olha esse vídeo https://x.com/user/status/1234567890');
    expect(url).toBe('https://x.com/user/status/1234567890');
  });

  it('detecta URL do Twitter (twitter.com)', () => {
    const url = VideoDownloader.detectVideoUrl('https://twitter.com/user/status/9876543210');
    expect(url).toBe('https://twitter.com/user/status/9876543210');
  });

  it('detecta URL do Instagram Reels', () => {
    const url = VideoDownloader.detectVideoUrl('https://instagram.com/reel/ABCdef123/');
    expect(url).toBe('https://instagram.com/reel/ABCdef123/');
  });

  it('detecta URL do Instagram Posts (/p/)', () => {
    const url = VideoDownloader.detectVideoUrl('https://www.instagram.com/p/XYZ789/');
    expect(url).toBe('https://www.instagram.com/p/XYZ789/');
  });

  it('detecta URL do Instagram TV', () => {
    const url = VideoDownloader.detectVideoUrl('https://instagram.com/tv/abcde/');
    expect(url).toBe('https://instagram.com/tv/abcde/');
  });

  it('remove pontuação do final da URL', () => {
    const url = VideoDownloader.detectVideoUrl('veja https://x.com/user/status/123.');
    // A URL não deve terminar com ponto
    expect(url).not.toMatch(/\.$/);
  });

  it('retorna null para texto sem URL suportada', () => {
    expect(VideoDownloader.detectVideoUrl('oi como vai?')).toBeNull();
  });

  it('retorna null para URL não suportada (youtube, etc)', () => {
    expect(VideoDownloader.detectVideoUrl('https://youtube.com/watch?v=abc')).toBeNull();
  });

  it('retorna null para null', () => {
    expect(VideoDownloader.detectVideoUrl(null)).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(VideoDownloader.detectVideoUrl('')).toBeNull();
  });
});
