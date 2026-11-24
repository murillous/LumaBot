// Figurinha com áudio nativo do WhatsApp (`!sticker áudio`): WebP (com `"sound-sha256"` no EXIF)
// + `AudioMessage` (OGG/Opus) no campo 26 do `StickerMessage`.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ffmpeg, withTempDir } from '#plugins/ffmpeg.ts';

const execFileAsync = promisify(execFile);

/** Teto da figurinha com áudio (10 s). */
export const AUDIO_STICKER_SECONDS = 10;

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
 * Extrai a faixa de áudio de um vídeo como OGG/Opus, limitado a `AUDIO_STICKER_SECONDS`.
 * Lança `NoAudioError` se o vídeo não tiver som.
 */
export async function extractAudio(video: Buffer, signal: AbortSignal): Promise<ExtractedAudio> {
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
          String(AUDIO_STICKER_SECONDS),
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
    const seconds = await probeSeconds(output, signal);
    return { data, sha256, seconds, mimetype: 'audio/ogg; codecs=opus' };
  });
}

/** Duração em segundos pelo `ffprobe`; sem ele, devolve `1` como fallback explícito. */
async function probeSeconds(file: string, signal: AbortSignal): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { signal },
    );
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : 1;
  } catch {
    return 1;
  }
}
