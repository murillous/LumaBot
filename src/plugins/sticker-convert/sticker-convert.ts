import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { type ActionSpec, trackerFor } from '#plugins/action-metrics.ts';
import { type AiToolContext, aiTool, fail, mediaMessage, ok } from '#plugins/ai-tools.ts';
import { checkBinary } from '#plugins/binary.ts';
import { attempt, mediaOf, usage } from '#plugins/media-command.ts';
import { isAnimated, stickerToMp4, stickerToPng } from './convert.ts';
import { CONVERT_DONE, CONVERT_FAILED, CONVERT_REFUSED, FFMPEG_MISSING } from './log-events.ts';

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

/** Cada conversão no log (`sticker-convert.convert.*`) e em `luma_sticker_convert_*`. */
const ACTION: ActionSpec = {
  metric: 'sticker_convert',
  help: 'Conversões de figurinha',
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
  events: { done: CONVERT_DONE, refused: CONVERT_REFUSED, failed: CONVERT_FAILED },
};

/** Figurinha de volta a imagem (`!image`) ou a vídeo (`!gif`). */
export const stickerConvert: PluginDefinition = definePlugin({
  name: 'sticker-convert',
  version: '0.0.0',
  engine: '<1.0.0',
  // O plugin exige só o download; cada comando exige a capability do que envia.
  requires: ['media.download'],
  // Opcional: sem o `metrics` as conversões seguem, só com o log.
  optionalDependsOn: { metrics: '*' },
  messages: MESSAGES,
  // Só o `!gif` usa o FFmpeg: sem ele, o `!image` segue funcionando.
  setup: async (ctx) => {
    const { messages } = ctx.plugin;
    const track = trackerFor(ACTION, ctx.services);
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
          await track(t.log, 'image', async (step) => {
            const png = await stickerToPng(await media.download());
            await t.reply.image(png, { caption: messages.imageDone, mimetype: 'image/png' });
            step.note({ bytes: png.length });
          });
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
          const sent = await track(t.log, 'gif', async (step) => {
            const sticker = await media.download();
            if (!(await isAnimated(sticker))) {
              step.refuse('not-animated');
              return false;
            }
            const mp4 = await stickerToMp4(sticker, t.signal);
            await t.reply.video(mp4, { caption: messages.gifDone, mimetype: 'video/mp4' });
            step.note({ bytes: mp4.length });
            return true;
          });
          return sent ? ok() : fail('not-animated');
        },
      }),
    );

    try {
      await checkBinary('ffmpeg', ['-version']);
    } catch (err) {
      ctx.log.event(FFMPEG_MISSING, { err });
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
      run: (ctx, plugin) =>
        attempt(ctx, trackerFor(ACTION, plugin.services), 'image', async (step) => {
          const png = await stickerToPng(await mediaOf(ctx).download());
          await ctx.reply.image(png, { caption: ctx.t('imageDone'), mimetype: 'image/png' });
          step.note({ bytes: png.length });
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
      run: async (ctx, plugin) => {
        let reply: string | undefined;
        const failed = await attempt(
          ctx,
          trackerFor(ACTION, plugin.services),
          'gif',
          async (step) => {
            const sticker = await mediaOf(ctx).download();
            if (!(await isAnimated(sticker))) {
              step.refuse('not-animated');
              reply = ctx.t('gifStatic');
              return;
            }
            const mp4 = await stickerToMp4(sticker, ctx.signal);
            await ctx.reply.video(mp4, { caption: ctx.t('gifDone'), mimetype: 'video/mp4' });
            step.note({ bytes: mp4.length });
          },
        );
        return failed ?? reply;
      },
    },
  },
});
