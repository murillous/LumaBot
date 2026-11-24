import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { type ActionSpec, hostOf, trackerFor } from '#plugins/action-metrics.ts';
import { aiTool, fail, mediaMessage, ok } from '#plugins/ai/tools.ts';
import { checkBinary } from '#plugins/binary.ts';
import { attempt, usage } from '#plugins/media-command.ts';
import { AUDIO_STICKER_SECONDS, extractAudio, NoAudioError } from './audio-sticker.ts';
import {
  animateToFit,
  encodeSticker,
  type StickerPack,
  toStickerImage,
  videoToSticker,
  withStickerExif,
} from './convert.ts';
import { fetchUrl, UrlFetchError } from './fetch-url.ts';
import { FFMPEG_MISSING, STICKER_DONE, STICKER_FAILED, STICKER_REFUSED } from './log-events.ts';

/** O que uma etapa recebe além da imagem. */
export interface StickerInput {
  /** Texto do comando, sem o link, numa linha; vazio se não houver. */
  readonly text: string;
}

/** Etapa sobre a figurinha estática: recebe o PNG 512×512 e devolve outro do mesmo tamanho. */
export type StickerStep = (image: Buffer, input: StickerInput) => Promise<Buffer>;

export interface CreateStickerOptions extends StickerInput {
  /** Vídeo ou GIF: vira figurinha animada, sem as etapas. */
  readonly animated: boolean;
  readonly signal: AbortSignal;
}

/**
 * Serviço `sticker`: outros plugins o usam pronto (`create`). Quem quer estender a figurinha
 * contribui ao ponto `sticker.steps`, sem que o `sticker` o conheça.
 */
export interface StickerService {
  /** Imagem ou vídeo → figurinha pronta (WebP com o pacote no EXIF), já com as etapas. */
  create(media: Buffer, options: CreateStickerOptions): Promise<Buffer>;
}

declare module '@usebridger/core' {
  interface Services {
    sticker: StickerService;
  }
  interface ExtensionPoints {
    /** Etapa sobre a figurinha estática, na ordem de carga de quem contribui. */
    'sticker.steps': StickerStep;
  }
}

/**
 * Textos ao usuário; a config do bot sobrescreve cada um (`messages`). `{prefix}` é o prefixo do
 * chat.
 */
const MESSAGES = {
  stickerPack: 'LumaBot Stickers',
  stickerAuthor: 'Criado com ❤️ por LumaBot',
  stickerUsage: 'ℹ️ Responda a uma imagem/vídeo com {prefix}sticker',
  stickerViewOnce: 'ℹ️ Não faço figurinha de mídia de visualização única.',
  stickerAudioUsage: 'ℹ️ Responda a um vídeo com som com {prefix}sa.',
  stickerNoAudio: '❌ Esse vídeo não tem áudio.',
  stickerAudioUnavailable: 'ℹ️ Figurinha com áudio não funciona por aqui.',
  urlError: '❌ Não consegui baixar esse link.',
  conversionError: '❌ Erro na conversão',
};

/** Conversão de vídeo é lenta; o padrão do bot é curto para ela. */
const TIMEOUT_MS = 60_000;
/** FFmpeg simultâneos no bot por comando: cada vídeo ocupa um núcleo e centenas de MB. */
const FFMPEG_CONCURRENCY = 2;

/**
 * Cada figurinha do `!sticker` e da tool no log (`sticker.create.*`) e em `luma_sticker_*`.
 * `kind`: `media` (da mensagem), `url` ou `audio` (`!sa`). A do `!downloadsticker`
 * conta no `download`.
 */
const ACTION: ActionSpec = {
  metric: 'sticker',
  help: 'Figurinhas',
  // Até o prazo do comando (60 s): a de vídeo passa pelo FFmpeg e leva segundos.
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
  events: { done: STICKER_DONE, refused: STICKER_REFUSED, failed: STICKER_FAILED },
  refusal: (err) =>
    err instanceof UrlFetchError
      ? 'url-failed'
      : err instanceof NoAudioError
        ? 'no-audio'
        : undefined,
};

/**
 * Figurinha (`!sticker`) e o serviço `sticker`, por onde outros plugins a estendem ou a usam.
 * Sem `send.sticker` o plugin não carrega, e quem depende dele também não.
 */
export const sticker: PluginDefinition = definePlugin({
  name: 'sticker',
  version: '1.0.0',
  engine: '<1.0.0',
  requires: ['media.download', 'send.sticker'],
  // Opcional: sem o `metrics` as figurinhas seguem, só com o log.
  optionalDependsOn: { metrics: '*' },
  messages: MESSAGES,
  setup: async (ctx) => {
    const pack: StickerPack = {
      name: ctx.plugin.messages.stickerPack,
      author: ctx.plugin.messages.stickerAuthor,
    };
    // Visão viva: `list()` a cada uso pega as etapas de quem contribuiu ou saiu depois.
    const steps = ctx.services.extensionPoint('sticker.steps');
    const service: StickerService = {
      create: async (media, { animated, text, signal }) => {
        if (animated) return videoToSticker(media, pack, signal);
        let image = await toStickerImage(media);
        for (const step of steps.list()) image = await step(image, { text });
        return encodeSticker(image, pack);
      },
    };
    ctx.services.provide('sticker', service);
    const track = trackerFor(ACTION, ctx.services);

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'create_sticker',
        description:
          'Cria uma figurinha e envia no chat. A fonte é o link `url`, se dado; senão, a imagem, vídeo, GIF ou figurinha da mensagem do usuário ou da mensagem que ele respondeu. `caption` é escrita na figurinha estática.',
        args: z.object({
          url: z
            .url()
            .optional()
            .describe('Link de uma imagem ou vídeo, como um achado na busca de imagens'),
          caption: z.string().optional().describe('Texto escrito na figurinha'),
        }),
        run: async ({ url, caption = '' }, t) => {
          const text = caption.replace(/\s+/g, ' ').trim();
          const send = async (bytes: Buffer, animated: boolean) => {
            const sticker = await service.create(bytes, { animated, text, signal: t.signal });
            await t.reply.sticker(sticker);
            return { animated, bytes: sticker.length };
          };
          if (url) {
            try {
              await track(
                { log: t.log.child({ host: hostOf(url) }), message: t.message },
                'url',
                async (step) => {
                  const bytes = await fetchUrl(url, t.signal);
                  step.note(await send(bytes, isAnimatedBytes(bytes)));
                },
              );
            } catch (err) {
              if (err instanceof UrlFetchError) return fail('url-failed');
              throw err;
            }
            return ok();
          }
          const source = mediaMessage(t.message, ['image', 'video', 'sticker']);
          if (!source) return fail('no-media');
          if (source.isViewOnce) return fail('view-once');
          await track(t, 'media', async (step) => {
            const bytes = await source.media.download();
            step.note(await send(bytes, isAnimatedMime(source.media.mimetype)));
          });
          return ok();
        },
      }),
    );

    // Só a figurinha de vídeo usa o FFmpeg: sem ele, a de imagem segue funcionando, e o aviso no
    // boot explica o erro que a de vídeo vai dar.
    try {
      await checkBinary('ffmpeg', ['-version']);
    } catch (err) {
      ctx.log.event(FFMPEG_MISSING, { err });
    }
  },
  commands: {
    sticker: {
      aliases: ['s'],
      description: 'Imagem, vídeo ou link → figurinha',
      // `text` por último: o link do `!s https://...` vem em mensagem sem mídia.
      accepts: [
        'image',
        'video',
        'sticker',
        'quoted:image',
        'quoted:video',
        'quoted:sticker',
        'text',
      ],
      onReject: usage('stickerUsage'),
      timeoutMs: TIMEOUT_MS,
      background: true,
      concurrency: FFMPEG_CONCURRENCY,
      run: async (ctx, plugin) => {
        const stickers = plugin.services.get('sticker');
        const track = trackerFor(ACTION, plugin.services);
        const url = /https?:\/\/\S+/i.exec(ctx.rawArgs)?.[0] ?? null;
        const text = (url ? ctx.rawArgs.replace(url, '') : ctx.rawArgs).replace(/\s+/g, ' ').trim();
        const linkError = (err: unknown) =>
          err instanceof UrlFetchError ? 'urlError' : 'conversionError';

        if (url) {
          return attempt(
            ctx,
            (at, kind, work) =>
              track({ ...at, log: at.log.child({ host: hostOf(url) }) }, kind, work),
            'url',
            async (step) => {
              const bytes = await fetchUrl(url, ctx.signal);
              const animated = isAnimatedBytes(bytes);
              const sticker = await stickers.create(bytes, { animated, text, signal: ctx.signal });
              await ctx.reply.sticker(sticker);
              step.note({ animated, bytes: sticker.length });
            },
            linkError,
          );
        }

        const source = ctx.media;
        if (!source) return usage('stickerUsage')(ctx);
        if (ctx.accepted?.message.isViewOnce) return usage('stickerViewOnce')(ctx);
        return attempt(ctx, track, 'media', async (step) => {
          const bytes = await source.download();
          const animated = isAnimatedMime(source.mimetype);
          const sticker = await stickers.create(bytes, { animated, text, signal: ctx.signal });
          await ctx.reply.sticker(sticker);
          step.note({ animated, bytes: sticker.length });
        });
      },
    },
    stickeraudio: {
      aliases: ['sa'],
      description: 'Vídeo com som → figurinha com áudio',
      accepts: ['video', 'quoted:video'],
      onReject: usage('stickerAudioUsage'),
      timeoutMs: TIMEOUT_MS,
      background: true,
      concurrency: FFMPEG_CONCURRENCY,
      run: async (ctx, plugin) => {
        // Sem a capability o kernel recusaria o envio só depois de converter: avisa antes.
        if (!plugin.capabilities.has('send.sticker.audio')) {
          return usage('stickerAudioUnavailable')(ctx);
        }
        const video = ctx.media;
        if (!video) return usage('stickerAudioUsage')(ctx);
        if (ctx.accepted?.message.isViewOnce) return usage('stickerViewOnce')(ctx);
        return attempt(
          ctx,
          trackerFor(ACTION, plugin.services),
          'audio',
          async (step) => {
            const bytes = await video.download();
            // A animação primeiro: o som é cortado na duração real dela, ao milissegundo.
            const animation = await animateToFit(bytes, ctx.signal, AUDIO_STICKER_SECONDS);
            const audio = await extractAudio(bytes, ctx.signal, animation.ms);
            const sticker = await withStickerExif(animation.webp, {
              name: ctx.t('stickerPack'),
              author: ctx.t('stickerAuthor'),
              soundSha256: audio.sha256,
            });
            await ctx.reply.sticker(sticker, {
              audio: audio.data,
              audioMimetype: audio.mimetype,
              audioSeconds: audio.seconds,
            });
            step.note({
              animated: true,
              audio: true,
              bytes: sticker.length,
              audioBytes: audio.data.length,
            });
          },
          (err) => (err instanceof NoAudioError ? 'stickerNoAudio' : 'conversionError'),
        );
      },
    },
  },
});

/** O GIF do WhatsApp chega como vídeo; o de outras plataformas, como `image/gif`. */
function isAnimatedMime(mimetype: string): boolean {
  return mimetype.startsWith('video/') || mimetype === 'image/gif';
}

/** GIF, MP4/MOV (caixa `ftyp`) ou WebM pelos bytes iniciais: o link nem sempre tem extensão. */
function isAnimatedBytes(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 4).toString('latin1') === 'GIF8' ||
    bytes.subarray(4, 8).toString('latin1') === 'ftyp' ||
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  );
}
