// Figurinha com áudio nativo do WhatsApp (`!sticker áudio`): WebP (com `"sound-sha256"` no EXIF)
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

/**
 * Extrai a faixa de áudio de um vídeo como OGG/Opus, cortada em `maxSeconds`.
 * Lança `NoAudioError` se o vídeo não tiver som.
 */
export async function extractAudio(
  video: Buffer,
  signal: AbortSignal,
  maxSeconds = AUDIO_STICKER_SECONDS,
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
          '-t',
          String(maxSeconds),
          '-vn',
          ...['-map_metadata', '-1', '-avoid_negative_ts', 'make_zero'],
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
 * Duração do OGG/Opus pela última página: a granule position (int64 LE no byte 6 do cabeçalho
 * `OggS`) conta amostras a 48 kHz, somadas ao pre-skip do `OpusHead` (uint16 LE no byte 10). Lê
 * dos bytes para não depender do `ffprobe`; nunca dá menos de 1 s, que o WhatsApp mostra.
 */
export function oggSeconds(ogg: Buffer): number {
  const page = ogg.lastIndexOf('OggS');
  if (page < 0 || page + 14 > ogg.length) return 1;
  const head = ogg.indexOf('OpusHead');
  const preSkip = head >= 0 && head + 12 <= ogg.length ? ogg.readUInt16LE(head + 10) : 0;
  const samples = Number(ogg.readBigInt64LE(page + 6)) - preSkip;
  return Math.max(1, Math.min(AUDIO_STICKER_SECONDS, Math.round(samples / 48_000)));
}
