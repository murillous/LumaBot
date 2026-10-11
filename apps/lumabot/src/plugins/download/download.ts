import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { type CommandContext, definePlugin, type PluginDefinition } from '@usebridger/core';
import { checkBinary } from '#plugins/binary.ts';
import { compactVideo, downloadAudio, downloadVideo, TooLargeError } from './yt-dlp.ts';

/**
 * Textos ao usuário; a config do bot sobrescreve cada um (`messages`). `{prefix}` é o prefixo do
 * chat.
 */
const MESSAGES = {
  downloadUsage:
    'ℹ️ Cole o link do vídeo junto com o comando.\nEx: `{prefix}download https://x.com/...`',
  audioUsage: 'ℹ️ Cole o link junto com o comando.\nEx: `{prefix}audio https://youtu.be/...`',
  videoSent: '🎬 Pronto!',
  imageSent: '🖼️ Pronto!',
  tooLarge: '❌ Arquivo muito grande para enviar (máx. 100 MB).',
  downloadError:
    '❌ Não consegui baixar esse vídeo. O conteúdo pode ser privado ou a URL inválida.',
  audioError: '❌ Não consegui baixar o áudio. O conteúdo pode ser privado ou a URL inválida.',
};

/**
 * Download e recodificação de vídeo longo; o legacy dava 4 min. Os comandos rodam fora da fila
 * do chat (`background`), para o grupo não esperar por eles.
 */
const TIMEOUT_MS = 240_000;
/** yt-dlp + FFmpeg simultâneos no bot por comando: cada um pesa em CPU, memória e banda. */
const CONCURRENCY = 2;
/** Post de foto (Instagram, X): o yt-dlp baixa a própria imagem, que vai sem passar pelo FFmpeg. */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export interface DownloadOptions {
  /** Arquivo de cookies (formato Netscape) de uma sessão logada, repassado ao yt-dlp. */
  readonly cookies?: string;
}

/** `!download` (vídeo ou foto de rede social) e `!audio` (MP3 de um link), pelo yt-dlp. */
export function download(options: DownloadOptions = {}): PluginDefinition {
  return definePlugin({
    name: 'download',
    version: '0.0.0',
    engine: '<1.0.0',
    messages: MESSAGES,
    // Sem os dois, nenhum comando funciona: o setup falha e o bot sobe sem o plugin, com o
    // motivo no relatório de boot.
    setup: async () => {
      await Promise.all([
        checkBinary('yt-dlp', ['--version']),
        checkBinary('ffmpeg', ['-version']),
      ]);
    },
    commands: {
      download: {
        aliases: ['d'],
        description: 'Baixa vídeo ou foto de um link (X, Instagram, TikTok...)',
        // O link pode ser de vídeo ou de post de foto: só se sabe depois de baixar.
        requires: ['send.video', 'send.image'],
        timeoutMs: TIMEOUT_MS,
        background: true,
        concurrency: CONCURRENCY,
        run: async (ctx) => {
          const url = findUrl(ctx);
          if (!url) return ctx.t('downloadUsage');
          return inTempDir(async (dir) => {
            await ctx.react('⏳');
            try {
              const file = await downloadVideo(url, dir, { ...options, signal: ctx.signal });
              if (IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) {
                await ctx.reply.image(await readFile(file), { caption: ctx.t('imageSent') });
              } else {
                const mp4 = await compactVideo(file, dir, ctx.signal);
                await ctx.reply.video(await readFile(mp4), {
                  caption: ctx.t('videoSent'),
                  mimetype: 'video/mp4',
                });
              }
            } catch (err) {
              ctx.log.error('falha no download', { err, url });
              await ctx.react('❌');
              return ctx.t(err instanceof TooLargeError ? 'tooLarge' : 'downloadError');
            }
            await ctx.react('✅');
            return undefined;
          });
        },
      },

      audio: {
        aliases: ['a'],
        description: 'Baixa o áudio de um link em MP3',
        requires: ['send.audio'],
        timeoutMs: TIMEOUT_MS,
        background: true,
        concurrency: CONCURRENCY,
        run: async (ctx) => {
          const url = findUrl(ctx);
          if (!url) return ctx.t('audioUsage');
          return inTempDir(async (dir) => {
            await ctx.react('⏳');
            try {
              const mp3 = await downloadAudio(url, dir, { ...options, signal: ctx.signal });
              await ctx.reply.audio(await readFile(mp3), { mimetype: 'audio/mpeg' });
            } catch (err) {
              ctx.log.error('falha no download de áudio', { err, url });
              await ctx.react('❌');
              return ctx.t(err instanceof TooLargeError ? 'tooLarge' : 'audioError');
            }
            await ctx.react('✅');
            return undefined;
          });
        },
      },
    },
  });
}

/** Link do comando ou, na falta, da mensagem citada, sem a pontuação colada no fim. */
function findUrl(ctx: CommandContext): string | null {
  for (const text of [ctx.rawArgs, ctx.message.quoted?.text]) {
    const url = text && /https?:\/\/\S+/i.exec(text)?.[0];
    if (url) return url.replace(/[.,!?'"]+$/, '');
  }
  return null;
}

/** Cada download no próprio diretório temporário, apagado no fim com ou sem erro. */
async function inTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lumabot-download-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
