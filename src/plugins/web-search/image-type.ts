// O tipo da imagem pelos primeiros bytes: o link que a IA passa pode levar a uma página HTML com
// extensão de imagem, e o transport não deve enviar isso como foto.

const SIGNATURES: readonly (readonly [string, readonly number[], number?])[] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  // RIFF....WEBP: o "WEBP" começa no byte 8.
  ['image/webp', [0x57, 0x45, 0x42, 0x50], 8],
];

/** O mimetype de JPEG, PNG, GIF ou WebP; `null` se os bytes não são de nenhum deles. */
export function imageMimetype(bytes: Buffer): string | null {
  for (const [mimetype, magic, offset = 0] of SIGNATURES) {
    if (magic.every((byte, i) => bytes[offset + i] === byte)) return mimetype;
  }
  return null;
}
