import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { type AiToolContext, aiTool, fail, mediaMessage, ok } from '#plugins/ai-tools.ts';
import { checkBinary } from '#plugins/binary.ts';
import { attempt, mediaOf, usage } from '#plugins/media-command.ts';
import { isAnimated, stickerToMp4, stickerToPng } from './convert.ts';

/**
 * Textos ao usuário; a config do bot sobrescreve cada um (`messages`). `{prefix}` é o prefixo do
 * chat.
 */
const MESSAGES = {
  imageUsage: 'ℹ️ Responda a um sticker com {prefix}image',
  imageDone: '🖼️ Convertido!',
  gifUsage: 'ℹ️ Responda a um sticker animado com {prefix}gif',
  gifStatic: 'ℹ️ Este é um sticker estático. Use {prefix}image para converter',
  gifDone: '🎬 Convertido!',
  conversionError: '❌ Erro na conversão',
};

/** Conversão de vídeo é lenta; o padrão do bot é curto para ela. */
const TIMEOUT_MS = 60_000;
/** FFmpeg simultâneos no bot por comando: cada vídeo ocupa um núcleo e centenas de MB. */
const FFMPEG_CONCURRENCY = 2;

/** Figurinha de volta a imagem (`!image`) ou a vídeo (`!gif`). */
export const stickerConvert: PluginDefinition = definePlugin({
  name: 'sticker-convert',
  version: '0.0.0',
  engine: '<1.0.0',
  // O plugin exige só o download; cada comando exige a capability do que envia.
  requires: ['media.download'],
  messages: MESSAGES,
  // Só o `!gif` usa o FFmpeg: sem ele, o `!image` segue funcionando.
  setup: async (ctx) => {
    const { messages } = ctx.plugin;
    // A figurinha que a pessoa mandou ou respondeu; `null` vira `no-sticker` para o modelo.
    const stickerOf = (t: AiToolContext) => mediaMessage(t.message, ['sticker'])?.media ?? null;
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'sticker_to_image',
        description:
          'Converte em imagem PNG a figurinha da mensagem do usuário ou da que ele respondeu, e envia no chat.',
        args: z.object({}),
        requires: ['send.image'],
        run: async (_, t) => {
          const media = stickerOf(t);
          if (!media) return fail('no-sticker');
          const png = await stickerToPng(await media.download());
          await t.reply.image(png, { caption: messages.imageDone, mimetype: 'image/png' });
          return ok();
        },
      }),
    );
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'sticker_to_video',
        description:
          'Converte em vídeo a figurinha animada da mensagem do usuário ou da que ele respondeu, e envia no chat.',
        args: z.object({}),
        requires: ['send.video'],
        run: async (_, t) => {
          const media = stickerOf(t);
          if (!media) return fail('no-sticker');
          const sticker = await media.download();
          if (!(await isAnimated(sticker))) return fail('not-animated');
          const mp4 = await stickerToMp4(sticker, t.signal);
          await t.reply.video(mp4, { caption: messages.gifDone, mimetype: 'video/mp4' });
          return ok();
        },
      }),
    );

    try {
      await checkBinary('ffmpeg', ['-version']);
    } catch (err) {
      ctx.log.warn('ffmpeg indisponível: !gif vai falhar', { err });
    }
  },
  commands: {
    image: {
      aliases: ['i'],
      description: 'Figurinha → imagem',
      requires: ['send.image'],
      accepts: ['sticker', 'quoted:sticker'],
      onReject: usage('imageUsage'),
      timeoutMs: TIMEOUT_MS,
      run: (ctx) =>
        attempt(ctx, async () => {
          const png = await stickerToPng(await mediaOf(ctx).download());
          await ctx.reply.image(png, { caption: ctx.t('imageDone'), mimetype: 'image/png' });
        }),
    },

    gif: {
      aliases: ['g'],
      description: 'Figurinha animada → GIF',
      requires: ['send.video'],
      accepts: ['sticker', 'quoted:sticker'],
      onReject: usage('gifUsage'),
      timeoutMs: TIMEOUT_MS,
      background: true,
      concurrency: FFMPEG_CONCURRENCY,
      run: async (ctx) => {
        let reply: string | undefined;
        const failed = await attempt(ctx, async () => {
          const sticker = await mediaOf(ctx).download();
          if (!(await isAnimated(sticker))) {
            reply = ctx.t('gifStatic');
            return;
          }
          const mp4 = await stickerToMp4(sticker, ctx.signal);
          await ctx.reply.video(mp4, { caption: ctx.t('gifDone'), mimetype: 'video/mp4' });
        });
        return failed ?? reply;
      },
    },
  },
});
