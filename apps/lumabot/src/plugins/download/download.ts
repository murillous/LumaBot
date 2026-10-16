import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { type CommandContext, definePlugin, type PluginDefinition } from '@usebridger/core';
import { checkBinary } from '#plugins/binary.ts';
import { withTempDir } from '#plugins/ffmpeg.ts';
import { attempt, urlIn } from '#plugins/media-command.ts';
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
  imageUnsupported: 'ℹ️ Esse link é de um post de foto, e este chat não aceita imagem.',
  tooLarge: '❌ Arquivo muito grande para enviar (máx. 100 MB).',
  downloadError:
    '❌ Não consegui baixar esse vídeo. O conteúdo pode ser privado ou a URL inválida.',
  audioError: '❌ Não consegui baixar o áudio. O conteúdo pode ser privado ou a URL inválida.',
  stickerUsage:
    'ℹ️ Cole o link junto com o comando; o texto depois do link vira legenda.\nEx: `{prefix}ds https://x.com/...`',
  stickerError: '❌ Baixei, mas não consegui fazer a figurinha.',
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

/**
 * `!download` (vídeo ou foto de rede social), `!audio` (MP3 de um link) e `!downloadsticker`
 * (o vídeo ou a foto como figurinha), pelo yt-dlp.
 */
export function download(options: DownloadOptions = {}): PluginDefinition {
  return definePlugin({
    name: 'download',
    version: '0.0.0',
    engine: '<1.0.0',
    // O `sticker` é opcional: sem ele, só o `!downloadsticker` fica de fora. Declarado, ele
    // carrega antes e o reload dele recarrega este plugin, e o comando acompanha.
    optionalDependsOn: { sticker: '0.x' },
    messages: MESSAGES,
    // Sem os dois, nenhum comando funciona: o setup falha e o boot aborta com o motivo. Para
    // subir sem o plugin, liste-o em `disabledPlugins`.
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
        // Exige só o vídeo, o caso comum: o post de foto só se revela depois de baixar, e exigir
        // também `send.image` tiraria o comando do transport que envia vídeo mas não imagem.
        requires: ['send.video'],
        timeoutMs: TIMEOUT_MS,
        background: true,
        concurrency: CONCURRENCY,
        run: async (ctx, plugin) => {
          const url = findUrl(ctx);
          if (!url) return ctx.t('downloadUsage');
          return withTempDir((dir) =>
            attempt(
              ctx,
              async () => {
                const file = await downloadVideo(url, dir, { ...options, signal: ctx.signal });
                if (isImage(file)) {
                  if (!plugin.capabilities.has('send.image')) throw new ImageUnsupportedError();
                  await ctx.reply.image(await readFile(file), { caption: ctx.t('imageSent') });
                  return;
                }
                const mp4 = await compactVideo(file, dir, ctx.signal);
                await ctx.reply.video(await readFile(mp4), {
                  caption: ctx.t('videoSent'),
                  mimetype: 'video/mp4',
                });
              },
              {
                errorKey: (err) =>
                  err instanceof ImageUnsupportedError
                    ? 'imageUnsupported'
                    : tooLargeOr('downloadError')(err),
                fields: { url },
              },
            ),
          );
        },
      },

      downloadsticker: {
        aliases: ['ds'],
        description: 'Baixa vídeo ou foto de um link e manda como figurinha',
        requires: ['send.sticker'],
        services: ['sticker'],
        timeoutMs: TIMEOUT_MS,
        background: true,
        concurrency: CONCURRENCY,
        run: async (ctx, plugin) => {
          const url = findUrl(ctx);
          if (!url) return ctx.t('stickerUsage');
          const stickers = plugin.services.get('sticker');
          const text = ctx.rawArgs.replace(url, '').replace(/\s+/g, ' ').trim();
          let downloaded = false;
          return withTempDir((dir) =>
            attempt(
              ctx,
              async () => {
                const file = await downloadVideo(url, dir, { ...options, signal: ctx.signal });
                downloaded = true;
                const sticker = await stickers.create(await readFile(file), {
                  animated: !isImage(file),
                  text,
                  signal: ctx.signal,
                });
                await ctx.reply.sticker(sticker);
              },
              {
                errorKey: (err) => (downloaded ? 'stickerError' : tooLargeOr('downloadError')(err)),
                fields: { url },
              },
            ),
          );
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
          return withTempDir((dir) =>
            attempt(
              ctx,
              async () => {
                const mp3 = await downloadAudio(url, dir, { ...options, signal: ctx.signal });
                await ctx.reply.audio(await readFile(mp3), { mimetype: 'audio/mpeg' });
              },
              { errorKey: tooLargeOr('audioError'), fields: { url } },
            ),
          );
        },
      },
    },
  });
}

/** Link do comando ou, na falta, da mensagem citada. */
function findUrl(ctx: CommandContext): string | null {
  return urlIn(ctx.rawArgs) ?? urlIn(ctx.message.quoted?.text);
}

function isImage(file: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(file).toLowerCase());
}

const tooLargeOr = (fallback: string) => (err: unknown) =>
  err instanceof TooLargeError ? 'tooLarge' : fallback;

/** Post de foto num transport sem `send.image`: só se descobre depois de baixar. */
class ImageUnsupportedError extends Error {}
