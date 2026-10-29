import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import {
  type CommandContext,
  definePlugin,
  type Logger,
  type PluginDefinition,
} from '@usebridger/core';
import type { MetricsService } from '@usebridger/plugin-metrics';
import { z } from 'zod';
import { type AiToolResult, aiTool, fail, ok } from '#plugins/ai-tools.ts';
import { checkBinary } from '#plugins/binary.ts';
import {
  BINARIES_MISSING,
  DOWNLOAD_DONE,
  DOWNLOAD_FAILED,
  DOWNLOAD_REFUSED,
} from './log-events.ts';
import {
  compactVideo,
  downloadAudio,
  downloadVideo,
  TooLargeError,
  type YtDlpOptions,
} from './yt-dlp.ts';

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
  unavailable: 'ℹ️ Download indisponível: faltam o `yt-dlp` ou o `ffmpeg` no servidor.',
  stickerUnavailable: 'ℹ️ Figurinha indisponível: o plugin `sticker` não está carregado.',
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

/** O que foi pedido: a mídia do link (vídeo ou foto), só o áudio ou a figurinha. */
type Kind = 'media' | 'audio' | 'sticker';
/** Download que terminou sem lançar: enviado, com o tamanho, ou recusado por motivo esperado. */
type Outcome = { readonly bytes: number } | { readonly refused: string };
type Track = (
  log: Logger,
  kind: Kind,
  url: string,
  work: () => Promise<Outcome>,
) => Promise<Outcome>;

export interface DownloadOptions {
  /** Arquivo de cookies (formato Netscape) de uma sessão logada, repassado ao yt-dlp. */
  readonly cookies?: string;
}

/**
 * `!download` (vídeo ou foto de rede social), `!audio` (MP3 de um link) e `!downloadsticker`
 * (o vídeo ou a foto como figurinha), pelo yt-dlp.
 */
export function download(options: DownloadOptions = {}): PluginDefinition {
  // Refeitos a cada setup (inclusive no reload), por instância do plugin.
  let binariesMissing = false;
  let track = tracker();
  return definePlugin({
    name: 'download',
    version: '0.0.0',
    engine: '<1.0.0',
    messages: MESSAGES,
    // Opcional: sem o `metrics` os downloads seguem, só com o log.
    optionalDependsOn: { metrics: '*' },
    // Sem os dois, nenhum comando funciona. Na 0.6 setup que lança derruba o bot inteiro, então
    // o plugin carrega, avisa no boot e cada comando responde `unavailable`.
    setup: async (ctx) => {
      track = tracker(ctx.services.has('metrics') ? ctx.services.get('metrics') : undefined);
      try {
        await Promise.all([
          checkBinary('yt-dlp', ['--version']),
          checkBinary('ffmpeg', ['-version']),
        ]);
        binariesMissing = false;
      } catch (err) {
        binariesMissing = true;
        ctx.log.event(BINARIES_MISSING, { err });
      }

      const url = z.url().describe('Link do post ou do vídeo');
      // Recusas esperadas de qualquer download; o resto vai para o `invokeTool`, que registra.
      const guarded = async (work: () => Promise<AiToolResult>) => {
        if (binariesMissing) return fail('unavailable');
        try {
          return await work();
        } catch (err) {
          if (err instanceof TooLargeError) return fail('too-large');
          throw err;
        }
      };
      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'download_media',
          description:
            'Baixa o vídeo ou a foto de um link (X, Instagram, TikTok, YouTube...) e envia no chat.',
          args: z.object({ url }),
          requires: ['send.video'],
          run: ({ url }, t) =>
            guarded(async () => {
              const sent = await track(t.log, 'media', url, () =>
                inTempDir(async (dir) => {
                  const post = await fetchPost(url, dir, { ...options, signal: t.signal });
                  if (post.kind === 'image') {
                    if (!ctx.capabilities.has('send.image'))
                      return { refused: 'image-unsupported' };
                    await t.reply.image(post.bytes, { caption: ctx.plugin.messages.imageSent });
                  } else {
                    await t.reply.video(post.bytes, {
                      caption: ctx.plugin.messages.videoSent,
                      mimetype: 'video/mp4',
                    });
                  }
                  return { bytes: post.bytes.length };
                }),
              );
              return 'refused' in sent ? fail(sent.refused) : ok();
            }),
        }),
      );
      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'download_audio',
          description: 'Baixa o áudio de um link em MP3 e envia no chat.',
          args: z.object({ url }),
          requires: ['send.audio'],
          run: ({ url }, t) =>
            guarded(async () => {
              await track(t.log, 'audio', url, () =>
                inTempDir(async (dir) => {
                  const mp3 = await downloadAudio(url, dir, { ...options, signal: t.signal });
                  const bytes = await readFile(mp3);
                  await t.reply.audio(bytes, { mimetype: 'audio/mpeg' });
                  return { bytes: bytes.length };
                }),
              );
              return ok();
            }),
        }),
      );
      ctx.services.contribute(
        'ai.tools',
        aiTool({
          name: 'download_sticker',
          description:
            'Baixa o vídeo ou a foto de um link e envia como figurinha. `caption` é escrita na figurinha estática.',
          args: z.object({ url, caption: z.string().optional().describe('Texto na figurinha') }),
          requires: ['send.sticker'],
          run: ({ url, caption = '' }, t) =>
            guarded(async () => {
              // Opcional como no `!downloadsticker`: consultado a cada uso.
              if (!ctx.services.has('sticker')) return fail('sticker-unavailable');
              const stickers = ctx.services.get('sticker');
              await track(t.log, 'sticker', url, () =>
                inTempDir(async (dir) => {
                  const file = await downloadVideo(url, dir, { ...options, signal: t.signal });
                  const sticker = await stickers.create(await readFile(file), {
                    animated: !IMAGE_EXTENSIONS.has(extname(file).toLowerCase()),
                    text: caption.replace(/\s+/g, ' ').trim(),
                    signal: t.signal,
                  });
                  await t.reply.sticker(sticker);
                  return { bytes: sticker.length };
                }),
              );
              return ok();
            }),
        }),
      );
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
          if (binariesMissing) return ctx.t('unavailable');
          const url = findUrl(ctx);
          if (!url) return ctx.t('downloadUsage');
          return inTempDir(async (dir) => {
            await ctx.react('⏳');
            try {
              const sent = await track(ctx.log, 'media', url, async () => {
                const post = await fetchPost(url, dir, { ...options, signal: ctx.signal });
                if (post.kind === 'image') {
                  if (!plugin.capabilities.has('send.image'))
                    return { refused: 'image-unsupported' };
                  await ctx.reply.image(post.bytes, { caption: ctx.t('imageSent') });
                } else {
                  await ctx.reply.video(post.bytes, {
                    caption: ctx.t('videoSent'),
                    mimetype: 'video/mp4',
                  });
                }
                return { bytes: post.bytes.length };
              });
              if ('refused' in sent) {
                await ctx.react('❌');
                return ctx.t('imageUnsupported');
              }
            } catch (err) {
              // O `track` já registrou a falha.
              await ctx.react('❌');
              return ctx.t(err instanceof TooLargeError ? 'tooLarge' : 'downloadError');
            }
            await ctx.react('✅');
            return undefined;
          });
        },
      },

      downloadsticker: {
        aliases: ['ds'],
        description: 'Baixa vídeo ou foto de um link e manda como figurinha',
        requires: ['send.sticker'],
        timeoutMs: TIMEOUT_MS,
        background: true,
        concurrency: CONCURRENCY,
        run: async (ctx, plugin) => {
          if (binariesMissing) return ctx.t('unavailable');
          const url = findUrl(ctx);
          if (!url) return ctx.t('stickerUsage');
          // O `sticker` é opcional: sem ele o `download` carrega igual e só este comando recusa.
          // Consultado a cada uso, pega o serviço novo depois de um reload do `sticker`.
          if (!plugin.services.has('sticker')) return ctx.t('stickerUnavailable');
          const stickers = plugin.services.get('sticker');
          const text = ctx.rawArgs.replace(url, '').replace(/\s+/g, ' ').trim();
          return inTempDir(async (dir) => {
            await ctx.react('⏳');
            let downloaded = false;
            try {
              await track(ctx.log, 'sticker', url, async () => {
                const file = await downloadVideo(url, dir, { ...options, signal: ctx.signal });
                downloaded = true;
                const sticker = await stickers.create(await readFile(file), {
                  animated: !IMAGE_EXTENSIONS.has(extname(file).toLowerCase()),
                  text,
                  signal: ctx.signal,
                });
                await ctx.reply.sticker(sticker);
                return { bytes: sticker.length };
              });
            } catch (err) {
              // O `track` já registrou a falha.
              await ctx.react('❌');
              if (downloaded) return ctx.t('stickerError');
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
          if (binariesMissing) return ctx.t('unavailable');
          const url = findUrl(ctx);
          if (!url) return ctx.t('audioUsage');
          return inTempDir(async (dir) => {
            await ctx.react('⏳');
            try {
              await track(ctx.log, 'audio', url, async () => {
                const mp3 = await downloadAudio(url, dir, { ...options, signal: ctx.signal });
                const bytes = await readFile(mp3);
                await ctx.reply.audio(bytes, { mimetype: 'audio/mpeg' });
                return { bytes: bytes.length };
              });
            } catch (err) {
              // O `track` já registrou a falha.
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

/**
 * Registra cada download no log (`download.media.*`) e, com o `metrics` carregado, em
 * `luma_download_total{kind, outcome}` e `luma_download_seconds{kind}`. A falha é relançada para
 * quem chamou responder ao usuário.
 */
function tracker(metrics?: MetricsService): Track {
  const total = metrics?.counter({
    name: 'luma_download_total',
    help: 'Downloads por tipo e resultado (ok, refused, error)',
    labelNames: ['kind', 'outcome'],
  });
  const seconds = metrics?.histogram({
    name: 'luma_download_seconds',
    help: 'Duração dos downloads enviados, da chamada ao yt-dlp ao envio',
    labelNames: ['kind'],
    // Até o prazo dos comandos (240 s): vídeo longo recodificado passa de um minuto.
    buckets: [1, 2, 5, 10, 20, 30, 60, 120, 240],
  });
  return async (log, kind, url, work) => {
    const host = URL.canParse(url) ? new URL(url).hostname : undefined;
    const start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    try {
      const outcome = await work();
      if ('refused' in outcome) {
        total?.inc({ kind, outcome: 'refused' });
        log.event(DOWNLOAD_REFUSED, { kind, host, reason: outcome.refused });
      } else {
        const durationMs = elapsed();
        total?.inc({ kind, outcome: 'ok' });
        seconds?.observe({ kind }, durationMs / 1000);
        log.event(DOWNLOAD_DONE, { kind, host, durationMs, bytes: outcome.bytes });
      }
      return outcome;
    } catch (err) {
      if (err instanceof TooLargeError) {
        total?.inc({ kind, outcome: 'refused' });
        log.event(DOWNLOAD_REFUSED, { kind, host, reason: 'too-large' });
      } else {
        total?.inc({ kind, outcome: 'error' });
        log.event(DOWNLOAD_FAILED, { err, kind, host, durationMs: elapsed() });
      }
      throw err;
    }
  };
}

/** Foto do post como veio, ou o vídeo recodificado para o WhatsApp. */
async function fetchPost(
  url: string,
  dir: string,
  options: YtDlpOptions,
): Promise<{ kind: 'image' | 'video'; bytes: Buffer }> {
  const file = await downloadVideo(url, dir, options);
  if (IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) {
    return { kind: 'image', bytes: await readFile(file) };
  }
  return { kind: 'video', bytes: await readFile(await compactVideo(file, dir, options.signal)) };
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
