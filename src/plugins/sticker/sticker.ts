import {
  definePlugin,
  type LogFields,
  type Media,
  type Message,
  type PluginDefinition,
  type StepHandler,
} from '@usebridger/core';
import { z } from 'zod';
import { type ActionSpec, hostOf, type Track, trackerFor } from '#plugins/action-metrics.ts';
import { aiTool, fail, mediaMessage, ok } from '#plugins/ai/tools.ts';
import { checkBinary } from '#plugins/binary.ts';
import { attempt, usage } from '#plugins/media-command.ts';
import {
  AUDIO_STICKER_SECONDS,
  audioOptions,
  type ExtractedAudio,
  extractAudio,
  NoAudioError,
} from './audio-sticker.ts';
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
  /**
   * Vídeo com som → figurinha animada com o `sound-sha256` no EXIF e o áudio a anexar no envio.
   * Lança `NoAudioError` se o vídeo não tiver som.
   */
  createWithAudio(video: Buffer, signal: AbortSignal): Promise<SoundSticker>;
}

/** Figurinha com áudio pronta: o `reply.sticker` a envia com `audioOptions(audio)`. */
export interface SoundSticker {
  readonly sticker: Buffer;
  readonly audio: ExtractedAudio;
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
  stickerAudioUsage:
    'ℹ️ Responda a uma imagem, a um vídeo com som, a uma figurinha ou a um áudio com {prefix}sa.',
  stickerAudioAskAudio: '🎙️ Agora manda o áudio dessa figurinha (toca até 20 s).',
  stickerAudioAskSticker: '🖼️ Agora manda a figurinha que vai tocar esse áudio.',
  stickerAudioJoinCancelled:
    'ℹ️ Não era o que eu esperava, então cancelei. Mande {prefix}sa de novo.',
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
 * `kind`: `media` (da mensagem), `url`, `audio` (`!sa` de vídeo) ou `join` (`!sa` que junta
 * figurinha e áudio). A do `!downloadsticker` conta no `download`.
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
      createWithAudio: async (video, signal) => {
        // A animação primeiro: o som é cortado na duração real dela, ao milissegundo. Vídeo
        // parado vira figurinha estática (0 ms), e o som vai inteiro até o teto.
        const animation = await animateToFit(video, signal, AUDIO_STICKER_SECONDS);
        const audio = await extractAudio(video, signal, animation.ms || undefined);
        return { sticker: await soundExif(animation.webp, pack, audio), audio };
      },
    };
    ctx.services.provide('sticker', service);
    const track = trackerFor(ACTION, ctx.services);
    ctx.conversations.define(JOIN_STEP, joinStep(track));

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
      description: 'Vídeo com som, ou imagem/figurinha + áudio → figurinha com áudio',
      accepts: [
        'image',
        'video',
        'quoted:image',
        'quoted:video',
        'quoted:sticker',
        'quoted:audio',
        'quoted:voice',
      ],
      onReject: usage('stickerAudioUsage'),
      timeoutMs: TIMEOUT_MS,
      background: true,
      concurrency: FFMPEG_CONCURRENCY,
      run: async (ctx, plugin) => {
        // Sem a capability o kernel recusaria o envio só depois de converter: avisa antes.
        if (!plugin.capabilities.has('send.sticker.audio')) {
          return usage('stickerAudioUnavailable')(ctx);
        }
        const source = ctx.media;
        if (!source) return usage('stickerAudioUsage')(ctx);
        if (ctx.accepted?.message.isViewOnce) return usage('stickerViewOnce')(ctx);

        // Figurinha ou áudio é só metade: o WhatsApp não deixa texto em nenhum dos dois, então a
        // outra metade vem na próxima mensagem da pessoa, que o passo `JOIN_STEP` trata.
        const type = ctx.accepted?.message.type;
        if (type === 'image' || type === 'sticker' || type === 'audio' || type === 'voice') {
          const raw = await source.download();
          // Imagem vira a figurinha estática do `!s` (com as etapas) e segue como figurinha.
          const bytes = (
            type === 'image'
              ? await plugin.services.get('sticker').create(raw, {
                  animated: false,
                  text: ctx.rawArgs.replace(/\s+/g, ' ').trim(),
                  signal: ctx.signal,
                })
              : raw
          ).toString('base64');
          const visual = type === 'image' || type === 'sticker';
          const half: JoinHalf = visual ? { sticker: bytes } : { audio: bytes };
          ctx.expectReply(JOIN_STEP, { data: half, ttlMs: JOIN_TTL_MS });
          return ctx.t(visual ? 'stickerAudioAskAudio' : 'stickerAudioAskSticker');
        }

        return attempt(
          ctx,
          trackerFor(ACTION, plugin.services),
          'audio',
          async (step) => {
            const { sticker, audio } = await plugin.services
              .get('sticker')
              .createWithAudio(await source.download(), ctx.signal);
            await ctx.reply.sticker(sticker, audioOptions(audio));
            step.note({ animated: true, ...soundFields(sticker, audio) });
          },
          (err) => (err instanceof NoAudioError ? 'stickerNoAudio' : 'conversionError'),
        );
      },
    },
  },
});

/** Passo de conversa do `!sa` que junta uma figurinha pronta e um áudio. */
const JOIN_STEP = 'sticker-audio-join';
/** Prazo para mandar a outra metade; vencido, a próxima mensagem segue o fluxo normal. */
const JOIN_TTL_MS = 2 * 60_000;

/** A metade que já veio, em base64: o `data` da espera é JSON. */
type JoinHalf = { readonly sticker: string } | { readonly audio: string };

/** Mídia da mensagem, se ela for a metade que falta: figurinha, ou áudio/nota de voz. */
function joinMedia(message: Message, want: 'sticker' | 'audio'): Media | null {
  if (message.isViewOnce) return null;
  if (want === 'sticker') return message.is('sticker') ? message.media : null;
  if (message.is('audio') || message.is('voice')) return message.media;
  return null;
}

/**
 * Trata a outra metade do `!sa`. Mensagem que não é a esperada cancela, com aviso: a espera a
 * consome, e ela não chegaria a mais ninguém.
 */
function joinStep(track: Track): StepHandler {
  return async (c) => {
    const half = c.data as JoinHalf;
    const media = joinMedia(c.message, 'sticker' in half ? 'audio' : 'sticker');
    if (!media) return c.reply(c.t('stickerAudioJoinCancelled'));
    const error = await attempt(
      c,
      track,
      'join',
      async (step) => {
        const bytes = await media.download();
        const sticker = 'sticker' in half ? Buffer.from(half.sticker, 'base64') : bytes;
        const sound = 'audio' in half ? Buffer.from(half.audio, 'base64') : bytes;
        // A figurinha segue como veio (estática ou animada, em loop); o som vai até o teto.
        const audio = await extractAudio(sound, c.signal);
        const pack = { name: c.t('stickerPack'), author: c.t('stickerAuthor') };
        const withSound = await soundExif(sticker, pack, audio);
        await c.reply.sticker(withSound, audioOptions(audio));
        step.note(soundFields(withSound, audio));
      },
      (err) => (err instanceof NoAudioError ? 'stickerNoAudio' : 'conversionError'),
    );
    if (error) await c.reply(error);
  };
}

/** Grava o hash do som no EXIF: é por ele que o WhatsApp liga o som à figurinha. */
function soundExif(webp: Buffer, pack: StickerPack, audio: ExtractedAudio): Promise<Buffer> {
  return withStickerExif(webp, { ...pack, soundSha256: audio.sha256 });
}

/** Campos do log da figurinha com áudio. */
function soundFields(sticker: Buffer, audio: ExtractedAudio): LogFields {
  return { audio: true, bytes: sticker.length, audioBytes: audio.data.length };
}

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
