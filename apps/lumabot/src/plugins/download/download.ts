import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import {
  type Capability,
  type CommandContext,
  definePlugin,
  type PluginDefinition,
} from '@usebridger/core';
import { checkBinary } from '#plugins/binary.ts';
import { compactVideo, downloadAudio, downloadVideo, TooLargeError } from './yt-dlp.ts';

/** Textos ao usuário; a config do bot sobrescreve cada um (`messages`). */
const MESSAGES = {
  downloadUsage: 'ℹ️ Cole o link do vídeo junto com o comando.\nEx: `!download https://x.com/...`',
  audioUsage: 'ℹ️ Cole o link junto com o comando.\nEx: `!audio https://youtu.be/...`',
  videoSent: '🎬 Pronto!',
  imageSent: '🖼️ Pronto!',
  tooLarge: '❌ Arquivo muito grande para enviar (máx. 100 MB).',
  downloadError:
    '❌ Não consegui baixar esse vídeo. O conteúdo pode ser privado ou a URL inválida.',
  audioError: '❌ Não consegui baixar o áudio. O conteúdo pode ser privado ou a URL inválida.',
  unsupported: 'ℹ️ Este chat não aceita esse tipo de mídia.',
};

/** Download e recodificação de vídeo longo seguram o chat (ADR 0042); o legacy dava 4 min. */
const TIMEOUT_MS = 240_000;
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
        timeoutMs: TIMEOUT_MS,
        run: async (ctx, plugin) => {
          const m = plugin.plugin.messages;
          if (!plugin.capabilities.has('send.video')) return m.unsupported;
          const url = findUrl(ctx);
          if (!url) return m.downloadUsage;
          const caps = plugin.capabilities;
          return inTempDir(async (dir) => {
            await react(ctx, caps, '⏳');
            try {
              const file = await downloadVideo(url, dir, { ...options, signal: ctx.signal });
              if (IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) {
                if (!caps.has('send.image')) return m.unsupported;
                await ctx.reply.image(await readFile(file), { caption: m.imageSent });
              } else {
                const mp4 = await compactVideo(file, dir, ctx.signal);
                await ctx.reply.video(await readFile(mp4), {
                  caption: m.videoSent,
                  mimetype: 'video/mp4',
                });
              }
            } catch (err) {
              ctx.log.error('falha no download', { err, url });
              await react(ctx, caps, '❌');
              return err instanceof TooLargeError ? m.tooLarge : m.downloadError;
            }
            await react(ctx, caps, '✅');
            return undefined;
          });
        },
      },

      audio: {
        aliases: ['a'],
        description: 'Baixa o áudio de um link em MP3',
        timeoutMs: TIMEOUT_MS,
        run: async (ctx, plugin) => {
          const m = plugin.plugin.messages;
          if (!plugin.capabilities.has('send.audio')) return m.unsupported;
          const url = findUrl(ctx);
          if (!url) return m.audioUsage;
          const caps = plugin.capabilities;
          return inTempDir(async (dir) => {
            await react(ctx, caps, '⏳');
            try {
              const mp3 = await downloadAudio(url, dir, { ...options, signal: ctx.signal });
              await ctx.reply.audio(await readFile(mp3), { mimetype: 'audio/mpeg' });
            } catch (err) {
              ctx.log.error('falha no download de áudio', { err, url });
              await react(ctx, caps, '❌');
              return err instanceof TooLargeError ? m.tooLarge : m.audioError;
            }
            await react(ctx, caps, '✅');
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

/** Reação é enfeite: sem a capability, o comando segue só com as respostas. */
async function react(
  ctx: CommandContext,
  capabilities: ReadonlySet<Capability>,
  emoji: string,
): Promise<void> {
  if (capabilities.has('reactions')) await ctx.react(emoji);
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
