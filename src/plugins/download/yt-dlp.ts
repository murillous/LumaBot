// Chamadas ao yt-dlp e ao FFmpeg, binários do sistema no PATH. O plugin só vê arquivos prontos.

import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** O WhatsApp aceita vídeo até uns 100 MB; o yt-dlp nem baixa o que passa disso. */
export const MAX_DOWNLOAD_MB = 100;

/** O arquivo passa de `MAX_DOWNLOAD_MB`: o yt-dlp sai sem erro e sem arquivo. */
export class TooLargeError extends Error {
  override readonly name = 'TooLargeError';
}

export interface YtDlpOptions {
  /** Cookies (formato Netscape) de uma sessão logada: Instagram e X pedem login para muita coisa. */
  readonly cookies?: string;
  readonly signal: AbortSignal;
}

/** Baixa o vídeo (ou a foto do post) em `dir` e devolve o caminho do arquivo. */
export function downloadVideo(url: string, dir: string, options: YtDlpOptions): Promise<string> {
  return ytDlp(
    url,
    [
      '-o',
      join(dir, 'media.%(ext)s'),
      // Post de foto não tem vídeo: o seletor cai no `best`, que é a própria imagem.
      '--format',
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format',
      'mp4',
    ],
    options,
  );
}

/** Baixa só o áudio, em MP3 com capa e tags; o nome do arquivo é o título. */
export function downloadAudio(url: string, dir: string, options: YtDlpOptions): Promise<string> {
  return ytDlp(
    url,
    [
      '-o',
      join(dir, '%(title).100B.%(ext)s'),
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '--embed-thumbnail',
      '--embed-metadata',
      '--convert-thumbnails',
      'jpg',
    ],
    options,
  );
}

/**
 * Recodifica em H.264 `preset medium`: mais lento que o `ultrafast`, mas o arquivo sai bem menor
 * no mesmo CRF, e o iOS não toca VP9/AV1/H.265 pelo WhatsApp. Sem libx264, só reposiciona o
 * índice (faststart) e mantém o codec.
 */
export async function compactVideo(
  input: string,
  dir: string,
  signal: AbortSignal,
): Promise<string> {
  const output = join(dir, 'compact.mp4');
  const encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p'];
  try {
    await ffmpeg(input, encode, output, signal);
  } catch (err) {
    if (signal.aborted) throw err;
    await ffmpeg(input, ['-c:v', 'copy'], output, signal);
  }
  return output;
}

async function ffmpeg(
  input: string,
  video: readonly string[],
  output: string,
  signal: AbortSignal,
): Promise<void> {
  await run(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      input,
      ...video,
      '-c:a',
      'copy',
      '-movflags',
      'faststart',
      output,
    ],
    signal,
  );
}

async function ytDlp(url: string, args: readonly string[], options: YtDlpOptions): Promise<string> {
  const stdout = await run(
    'yt-dlp',
    [
      ...args,
      '--max-filesize',
      `${MAX_DOWNLOAD_MB}M`,
      '--no-playlist',
      '--no-warnings',
      // Sem o extrator genérico, só sites conhecidos: um link para a rede interna do servidor
      // (SSRF) não é baixado.
      '--use-extractors',
      'default,-generic',
      // Caminho final, depois do merge e da conversão; `after_move` não liga o `--simulate`.
      '--print',
      'after_move:filepath',
      ...(options.cookies ? ['--cookies', options.cookies] : []),
      '--',
      url,
    ],
    options.signal,
  );
  const path = stdout.trim().split('\n').at(-1)?.trim();
  // Falha de verdade sai com código de erro. Sair limpo sem imprimir o caminho é o arquivo acima
  // do `--max-filesize`: o aviso dele some no modo silencioso que o `--print` liga.
  if (!path) throw new TooLargeError(url);
  return path;
}

/** `execFile` com o stderr na mensagem de erro, que é onde o yt-dlp e o FFmpeg explicam a falha. */
function run(command: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { signal, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err)
        reject(new Error(`${command} falhou: ${stderr.trim() || err.message}`, { cause: err }));
      else resolve(stdout);
    });
  });
}
