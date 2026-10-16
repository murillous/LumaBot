import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { checkBinary } from '#plugins/binary.ts';
import { attempt, usage } from '#plugins/media-command.ts';
import { encodeSticker, type StickerPack, toStickerImage, videoToSticker } from './convert.ts';
import { fetchUrl, UrlFetchError } from './fetch-url.ts';

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
  urlError: '❌ Não consegui baixar esse link.',
  conversionError: '❌ Erro na conversão',
};

/** Conversão de vídeo é lenta; o padrão do bot é curto para ela. */
const TIMEOUT_MS = 60_000;
/** FFmpeg simultâneos no bot por comando: cada vídeo ocupa um núcleo e centenas de MB. */
const FFMPEG_CONCURRENCY = 2;

/**
 * Figurinha (`!sticker`) e o serviço `sticker`, por onde outros plugins a estendem ou a usam.
 * Sem `send.sticker` o plugin não carrega, e quem depende dele também não.
 */
export const sticker: PluginDefinition = definePlugin({
  name: 'sticker',
  version: '1.0.0',
  engine: '<1.0.0',
  requires: ['media.download', 'send.sticker'],
  messages: MESSAGES,
  setup: async (ctx) => {
    const pack: StickerPack = {
      name: ctx.plugin.messages.stickerPack,
      author: ctx.plugin.messages.stickerAuthor,
    };
    // Visão viva: `list()` a cada uso pega as etapas de quem contribuiu ou saiu depois.
    const steps = ctx.services.extensionPoint('sticker.steps');
    ctx.services.provide('sticker', {
      create: async (media, { animated, text, signal }) => {
        if (animated) return videoToSticker(media, pack, signal);
        let image = await toStickerImage(media);
        for (const step of steps.list()) image = await step(image, { text });
        return encodeSticker(image, pack);
      },
    });

    // Só a figurinha de vídeo usa o FFmpeg: sem ele, a de imagem segue funcionando, e o aviso no
    // boot explica o erro que a de vídeo vai dar.
    try {
      await checkBinary('ffmpeg', ['-version']);
    } catch (err) {
      ctx.log.warn('ffmpeg indisponível: figurinha de vídeo vai falhar', { err });
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
        const url = /https?:\/\/\S+/i.exec(ctx.rawArgs)?.[0] ?? null;
        const text = (url ? ctx.rawArgs.replace(url, '') : ctx.rawArgs).replace(/\s+/g, ' ').trim();
        const linkError = (err: unknown) =>
          err instanceof UrlFetchError ? 'urlError' : 'conversionError';

        if (url) {
          return attempt(
            ctx,
            async () => {
              const bytes = await fetchUrl(url, ctx.signal);
              await ctx.reply.sticker(
                await stickers.create(bytes, {
                  animated: isAnimatedBytes(bytes),
                  text,
                  signal: ctx.signal,
                }),
              );
            },
            linkError,
          );
        }

        const source = ctx.media;
        if (!source) return usage('stickerUsage')(ctx);
        if (ctx.accepted?.message.isViewOnce) return usage('stickerViewOnce')(ctx);
        return attempt(ctx, async () => {
          const bytes = await source.download();
          // O GIF do WhatsApp chega como vídeo; o de outras plataformas, como `image/gif`.
          const animated = source.mimetype.startsWith('video/') || source.mimetype === 'image/gif';
          await ctx.reply.sticker(
            await stickers.create(bytes, { animated, text, signal: ctx.signal }),
          );
        });
      },
    },
  },
});

/** GIF, MP4/MOV (caixa `ftyp`) ou WebM pelos bytes iniciais: o link nem sempre tem extensão. */
function isAnimatedBytes(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 4).toString('latin1') === 'GIF8' ||
    bytes.subarray(4, 8).toString('latin1') === 'ftyp' ||
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  );
}
