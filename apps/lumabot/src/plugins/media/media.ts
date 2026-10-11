import {
  type CommandContext,
  definePlugin,
  type Media,
  type PluginDefinition,
  type RejectContext,
} from '@usebridger/core';
import { checkBinary } from '#plugins/binary.ts';
import {
  imageToPdf,
  imageToSticker,
  isAnimated,
  mergePdfs,
  type StickerPack,
  stickerToMp4,
  stickerToPng,
  videoToSticker,
} from './convert.ts';
import { fetchUrl, UrlFetchError } from './fetch-url.ts';

/**
 * Textos ao usuário; a config do bot sobrescreve cada um (`messages`). `{prefix}` é o prefixo do
 * chat, e os demais placeholders vêm do comando (`ctx.t`).
 */
const MESSAGES = {
  stickerPack: 'LumaBot Stickers',
  stickerAuthor: 'Criado com ❤️ por LumaBot',
  stickerUsage: 'ℹ️ Responda a uma imagem/vídeo com {prefix}sticker',
  stickerViewOnce: 'ℹ️ Não faço figurinha de mídia de visualização única.',
  imageUsage: 'ℹ️ Responda a um sticker com {prefix}image',
  imageDone: '🖼️ Convertido!',
  gifUsage: 'ℹ️ Responda a um sticker animado com {prefix}gif',
  gifStatic: 'ℹ️ Este é um sticker estático. Use {prefix}image para converter',
  gifDone: '🎬 Convertido!',
  pdfUsage:
    'ℹ️ Envie uma imagem com {prefix}pdf ou responda a uma imagem com {prefix}pdf nome do arquivo',
  mergeUsage:
    'ℹ️ Envie/responda PDFs com {prefix}mergepdf para adicionar. Finalize com {prefix}mergepdf done nome do arquivo. Use {prefix}mergepdf clear para cancelar.',
  mergeAdded: '📎 PDF adicionado ({count}).',
  mergeNeedMore: 'ℹ️ Adicione pelo menos 2 PDFs antes de finalizar.',
  mergeCleared: '🗑️ Lista de PDFs limpa.',
  mergeFull:
    '❌ A lista de PDFs passou de 50 MB. Finalize com {prefix}mergepdf done ou limpe com {prefix}mergepdf clear.',
  urlError: '❌ Não consegui baixar esse link.',
  conversionError: '❌ Erro na conversão',
};

/** Conversão de vídeo é lenta; o padrão do bot é curto para ela. */
const TIMEOUT_MS = 60_000;
/** FFmpeg simultâneos no bot por comando: cada vídeo ocupa um núcleo e centenas de MB. */
const FFMPEG_CONCURRENCY = 2;
/** A fila do `!mergepdf` vive em memória: teto de bytes e validade contra quem não finaliza. */
const MERGE_MAX_BYTES = 50 * 1024 * 1024;
const MERGE_TTL_MS = 30 * 60_000;
const PDF_MIMETYPE = 'application/pdf';

interface PendingMerge {
  readonly pdfs: Buffer[];
  bytes: number;
  expiresAt: number;
}

/** Recusa do `accepts`: ❌ na mensagem e o texto de uso. */
function usage(key: keyof typeof MESSAGES) {
  return async (ctx: RejectContext): Promise<string> => {
    await ctx.react('❌');
    return ctx.t(key);
  };
}

/**
 * Figurinha, imagem, GIF e PDF (`!sticker`, `!image`, `!gif`, `!pdf`, `!mergepdf`). Cada bot
 * chama `media()` e ganha a própria fila do `!mergepdf`.
 */
export function media(): PluginDefinition {
  // Chave: chat + remetente, para duas pessoas no mesmo grupo não juntarem PDFs uma da outra.
  const merges = new Map<string, PendingMerge>();

  return definePlugin({
    name: 'media',
    version: '0.0.0',
    engine: '<1.0.0',
    // O plugin exige só o download; cada comando exige a capability do que envia, e um
    // transport sem figurinha (Discord) perde só o `!sticker`.
    requires: ['media.download'],
    messages: MESSAGES,
    // Só vídeo → figurinha e o `!gif` usam o FFmpeg: sem ele, imagem e PDF seguem funcionando,
    // e o aviso no boot explica o erro que esses dois vão dar.
    setup: async (ctx) => {
      try {
        await checkBinary('ffmpeg', ['-version']);
      } catch (err) {
        ctx.log.warn('ffmpeg indisponível: figurinha de vídeo e !gif vão falhar', { err });
      }
    },
    commands: {
      sticker: {
        aliases: ['s'],
        description: 'Imagem, vídeo ou link → figurinha (texto opcional vira legenda)',
        requires: ['send.sticker'],
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
          const m = plugin.plugin.messages;
          const url = /https?:\/\/\S+/i.exec(ctx.rawArgs)?.[0] ?? null;
          const text = stickerText(ctx.rawArgs, url);
          const pack: StickerPack = { name: m.stickerPack, author: m.stickerAuthor };

          if (url) {
            return attempt(ctx, async () => {
              const bytes = await fetchUrl(url, ctx.signal);
              await ctx.reply.sticker(
                isAnimatedBytes(bytes)
                  ? await videoToSticker(bytes, pack, ctx.signal)
                  : await imageToSticker(bytes, pack, text),
              );
            });
          }

          const source = ctx.media;
          if (!source) return usage('stickerUsage')(ctx);
          if (ctx.accepted?.message.isViewOnce) return usage('stickerViewOnce')(ctx);
          return attempt(ctx, async () => {
            const bytes = await source.download();
            // O GIF do WhatsApp chega como vídeo; o de outras plataformas, como `image/gif`.
            const animated =
              source.mimetype.startsWith('video/') || source.mimetype === 'image/gif';
            await ctx.reply.sticker(
              animated
                ? await videoToSticker(bytes, pack, ctx.signal)
                : await imageToSticker(bytes, pack, text),
            );
          });
        },
      },

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

      pdf: {
        description: 'Imagem → PDF (`!pdf nome do arquivo`)',
        requires: ['send.document'],
        accepts: ['image', 'quoted:image'],
        onReject: usage('pdfUsage'),
        timeoutMs: TIMEOUT_MS,
        run: (ctx) =>
          attempt(ctx, async () => {
            const pdf = await imageToPdf(await mediaOf(ctx).download());
            await ctx.reply.document(pdf, {
              fileName: pdfFileName(ctx.rawArgs, 'imagem.pdf'),
              mimetype: PDF_MIMETYPE,
            });
          }),
      },

      mergepdf: {
        aliases: ['joinpdf'],
        description: 'Junta PDFs: adicione um por vez, `done nome` finaliza, `clear` cancela',
        requires: ['send.document'],
        // `text` por último: o `done` e o `clear` vêm sem PDF.
        accepts: [`document:${PDF_MIMETYPE}`, `quoted:document:${PDF_MIMETYPE}`, 'text'],
        onReject: (ctx) => ctx.t('mergeUsage'),
        timeoutMs: TIMEOUT_MS,
        run: async (ctx) => {
          const key = `${ctx.message.chat.id}:${ctx.message.sender.id}`;
          dropExpired(merges);
          const [action = '', ...rest] = ctx.args;

          if (/^(clear|limpar|cancelar)$/i.test(action)) {
            merges.delete(key);
            return ctx.t('mergeCleared');
          }

          if (/^(done|pronto|finalizar)$/i.test(action)) {
            const pending = merges.get(key);
            if (!pending || pending.pdfs.length < 2) return ctx.t('mergeNeedMore');
            const failed = await attempt(ctx, async () => {
              await ctx.reply.document(await mergePdfs(pending.pdfs), {
                fileName: pdfFileName(rest.join(' '), 'pdf-juntado.pdf'),
                mimetype: PDF_MIMETYPE,
              });
            });
            // Falhou: a lista fica, para a pessoa tentar de novo ou limpar.
            if (!failed) merges.delete(key);
            return failed;
          }

          const source = ctx.media;
          if (!source) return ctx.t('mergeUsage');
          const pending = merges.get(key) ?? { pdfs: [], bytes: 0, expiresAt: 0 };
          // Com o tamanho informado, recusa antes de baixar.
          if (pending.bytes + (source.size ?? 0) > MERGE_MAX_BYTES) return ctx.t('mergeFull');
          let reply: string | undefined;
          const failed = await attempt(ctx, async () => {
            const pdf = await source.download();
            if (pending.bytes + pdf.length > MERGE_MAX_BYTES) {
              reply = ctx.t('mergeFull');
              return;
            }
            pending.pdfs.push(pdf);
            pending.bytes += pdf.length;
            pending.expiresAt = Date.now() + MERGE_TTL_MS;
            merges.set(key, pending);
            reply = ctx.t('mergeAdded', { count: pending.pdfs.length });
          });
          return failed ?? reply;
        },
      },
    },
  });
}

/** Mídia do comando cujo `accepts` só lista tipos com mídia: o kernel já garantiu que existe. */
function mediaOf(ctx: CommandContext): Media {
  if (!ctx.media) throw new Error(`!${ctx.command} rodou sem a mídia do accepts`);
  return ctx.media;
}

/**
 * Roda a conversão entre as reações de andamento (⏳, ✅ ou ❌). Devolve o texto de erro para
 * o comando responder, ou `undefined` se deu certo.
 */
async function attempt(
  ctx: CommandContext,
  work: () => Promise<void>,
): Promise<string | undefined> {
  await ctx.react('⏳');
  try {
    await work();
  } catch (err) {
    ctx.log.error('falha ao processar mídia', { err });
    await ctx.react('❌');
    return ctx.t(err instanceof UrlFetchError ? 'urlError' : 'conversionError');
  }
  await ctx.react('✅');
  return undefined;
}

/** Texto do `!sticker` sem o link, numa linha e com até 90 caracteres; `null` se vazio. */
function stickerText(rawArgs: string, url: string | null): string | null {
  const text = (url ? rawArgs.replace(url, '') : rawArgs).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 90) : null;
}

/** GIF, MP4/MOV (caixa `ftyp`) ou WebM pelos bytes iniciais: o link nem sempre tem extensão. */
function isAnimatedBytes(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 4).toString('latin1') === 'GIF8' ||
    bytes.subarray(4, 8).toString('latin1') === 'ftyp' ||
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  );
}

/** Nome digitado → `nome-do-arquivo.pdf`, sem acento nem símbolo; vazio, o `fallback`. */
function pdfFileName(raw: string, fallback: string): string {
  const slug = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug ? `${slug}.pdf` : fallback;
}

function dropExpired(merges: Map<string, PendingMerge>): void {
  const now = Date.now();
  for (const [key, pending] of merges) {
    if (pending.expiresAt <= now) merges.delete(key);
  }
}
