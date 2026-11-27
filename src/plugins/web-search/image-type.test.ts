import { describe, expect, it } from 'vitest';
import { imageMimetype } from './image-type.ts';

describe('imageMimetype', () => {
  it.each([
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ['image/webp', [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]],
  ])('reconhece %s pelos primeiros bytes', (mimetype, bytes) => {
    expect(imageMimetype(Buffer.from(bytes))).toBe(mimetype);
  });

  it('HTML ou arquivo curto não é imagem', () => {
    expect(imageMimetype(Buffer.from('<!doctype html>'))).toBeNull();
    expect(imageMimetype(Buffer.from([0xff]))).toBeNull();
  });
});
