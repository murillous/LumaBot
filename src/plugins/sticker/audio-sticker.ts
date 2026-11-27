// Figurinha com áudio nativo do WhatsApp (`!sa`): WebP (com `"sound-sha256"` no EXIF)
// + `AudioMessage` (OGG/Opus) no campo 26 do `StickerMessage`.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg, withTempDir } from '#plugins/ffmpeg.ts';

/** Teto da figurinha com áudio, o mesmo da figurinha de vídeo. */
export const AUDIO_STICKER_SECONDS = 20;

/** O vídeo veio sem faixa de áudio: recusa, não é falha do bot. */
export class NoAudioError extends Error {
  constructor() {
    super('o vídeo não tem faixa de áudio');
    this.name = 'NoAudioError';
  }
}

export interface ExtractedAudio {
  readonly data: Buffer;
  readonly sha256: string;
  readonly seconds: number;
  readonly mimetype: string;
}

/** Opções do `reply.sticker` que anexam o áudio à figurinha. */
export function audioOptions(audio: ExtractedAudio) {
  return { audio: audio.data, audioMimetype: audio.mimetype, audioSeconds: audio.seconds };
}

/**
 * Extrai a faixa de áudio de um vídeo (ou de um áudio) como OGG/Opus. Com `ms`, sai com
 * exatamente essa duração, na mesma linha do tempo da animação. Sem, vai até
 * `AUDIO_STICKER_SECONDS`: é o áudio juntado a uma figurinha pronta, ou a animação estática, que
 * não têm com o que sincronizar. Lança `NoAudioError` se a mídia não tiver som.
 */
export async function extractAudio(
  video: Buffer,
  signal: AbortSignal,
  ms?: number,
): Promise<ExtractedAudio> {
  return withTempDir(async (dir) => {
    const input = join(dir, 'in');
    const output = join(dir, 'out.ogg');
    await writeFile(input, video);
    try {
      await ffmpeg(
        [
          '-i',
          input,
          '-map',
          '0:a:0',
          '-vn',
          ...['-map_metadata', '-1'],
          // Sincronia com a animação: `first_pts=0` preenche com silêncio o atraso do áudio em
          // relação ao início do vídeo (sem isso o som sai adiantado), e `apad` + `-t` deixam o
          // som com a duração exata da animação, nem mais curto nem mais longo.
          ...(ms
            ? ['-af', 'aresample=async=1:first_pts=0,apad', '-t', String(ms / 1000)]
            : ['-af', 'aresample=async=1:first_pts=0', '-t', String(AUDIO_STICKER_SECONDS)]),
          ...['-c:a', 'libopus', '-b:a', '64k', '-ac', '1', '-ar', '48000'],
          ...['-f', 'ogg', output],
        ],
        signal,
      );
    } catch (err) {
      const stderr = (err as { stderr?: unknown } | null)?.stderr;
      if (typeof stderr === 'string' && stderr.includes('matches no streams')) {
        throw new NoAudioError();
      }
      throw err;
    }
    const data = await readFile(output);
    const sha256 = createHash('sha256').update(data).digest('base64');
    const seconds = oggSeconds(data);
    return { data, sha256, seconds, mimetype: 'audio/ogg; codecs=opus' };
  });
}

/**
 * Duração do OGG/Opus em ms pela última página: a granule position (int64 LE no byte 6 do
 * cabeçalho `OggS`) conta amostras a 48 kHz, somadas ao pre-skip do `OpusHead` (uint16 LE no byte
 * 10). Lê dos bytes para não depender do `ffprobe`; sem página OGG, devolve 0.
 */
export function oggMs(ogg: Buffer): number {
  const page = ogg.lastIndexOf('OggS');
  if (page < 0 || page + 14 > ogg.length) return 0;
  const head = ogg.indexOf('OpusHead');
  const preSkip = head >= 0 && head + 12 <= ogg.length ? ogg.readUInt16LE(head + 10) : 0;
  return ((Number(ogg.readBigInt64LE(page + 6)) - preSkip) * 1000) / 48_000;
}

/** Duração em segundos inteiros, como o WhatsApp mostra: nunca menos de 1 s. */
export function oggSeconds(ogg: Buffer): number {
  return Math.max(1, Math.min(AUDIO_STICKER_SECONDS, Math.round(oggMs(ogg) / 1000)));
}
