// FFmpeg (binário do sistema, no PATH) para os plugins que convertem vídeo e animação.

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function ffmpeg(args: readonly string[], signal: AbortSignal): Promise<void> {
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { signal });
}

/** O FFmpeg trabalha com arquivos (MP4 não se lê de pipe); o diretório some no fim, com ou sem erro. */
export async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lumabot-media-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
