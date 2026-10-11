import {
  type Capability,
  type CommandContext,
  definePlugin,
  type Media,
  type Message,
  type PluginContext,
  type PluginDefinition,
} from '@usebridger/core';
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

/** Textos ao usuário; a config do bot sobrescreve cada um (`messages`). */
const MESSAGES = {
  stickerPack: 'LumaBot Stickers',
  stickerAuthor: 'Criado com ❤️ por LumaBot',
  stickerUsage: 'ℹ️ Responda a uma imagem/vídeo com !sticker',
  stickerViewOnce: 'ℹ️ Não faço figurinha de mídia de visualização única.',
  imageUsage: 'ℹ️ Responda a um sticker com !image',
  imageDone: '🖼️ Convertido!',
  gifUsage: 'ℹ️ Responda a um sticker animado com !gif',
  gifStatic: 'ℹ️ Este é um sticker estático. Use !image para converter',
  gifDone: '🎬 Convertido!',
  pdfUsage: 'ℹ️ Envie uma imagem com !pdf ou responda a uma imagem com !pdf nome do arquivo',
  mergeUsage:
    'ℹ️ Envie/responda PDFs com !mergepdf para adicionar. Finalize com !mergepdf done nome do arquivo. Use !mergepdf clear para cancelar.',
  mergeAdded: '📎 PDF adicionado',
  mergeNeedMore: 'ℹ️ Adicione pelo menos 2 PDFs antes de finalizar.',
  mergeCleared: '🗑️ Lista de PDFs limpa.',
  mergeFull:
    '❌ A lista de PDFs passou de 50 MB. Finalize com !mergepdf done ou limpe com !mergepdf clear.',
  urlError: '❌ Não consegui baixar esse link.',
  conversionError: '❌ Erro na conversão',
  unsupported: 'ℹ️ Este chat não aceita esse tipo de mídia.',
};

type Messages = typeof MESSAGES;
type Plugin = PluginContext<unknown, Messages>;
type MediaMessage = Extract<Message, { readonly media: Media }>;

/** Conversão e download seguram o chat (ADR 0042); o padrão do bot é curto para um vídeo. */
const TIMEOUT_MS = 60_000;
/** A fila do `!mergepdf` vive em memória: teto de bytes e validade contra quem não finaliza. */
const MERGE_MAX_BYTES = 50 * 1024 * 1024;
const MERGE_TTL_MS = 30 * 60_000;
const PDF_MIMETYPE = 'application/pdf';

interface PendingMerge {
  readonly pdfs: Buffer[];
  bytes: number;
  expiresAt: number;
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
    // Só o download é exigido: cada comando confere a capability de envio dele, para um transport
    // sem figurinha (Discord) não perder também imagem e PDF.
    requires: ['media.download'],
    messages: MESSAGES,
    commands: {
      sticker: {
        aliases: ['s'],
        description: 'Imagem, vídeo ou link → figurinha (texto opcional vira legenda)',
        timeoutMs: TIMEOUT_MS,
        run: async (ctx, plugin) => {
          const m = plugin.plugin.messages;
          if (!plugin.capabilities.has('send.sticker')) return m.unsupported;
          const url = /https?:\/\/\S+/i.exec(ctx.rawArgs)?.[0] ?? null;
          const text = stickerText(ctx.rawArgs, url);
          const pack: StickerPack = { name: m.stickerPack, author: m.stickerAuthor };

          if (url) {
            return attempt(ctx, plugin, async () => {
              const bytes = await fetchUrl(url, ctx.signal);
              await ctx.reply.sticker(
                isAnimatedBytes(bytes)
                  ? await videoToSticker(bytes, pack, ctx.signal)
                  : await imageToSticker(bytes, pack, text),
              );
            });
          }

          const source = pickMedia(ctx.message, (msg) =>
            ['image', 'video', 'sticker'].includes(msg.type),
          );
          if (!source) return usage(ctx, plugin, m.stickerUsage);
          if (source.isViewOnce) return usage(ctx, plugin, m.stickerViewOnce);
          return attempt(ctx, plugin, async () => {
            const bytes = await source.media.download();
            const { mimetype } = source.media;
            // O GIF do WhatsApp chega como vídeo; o de outras plataformas, como `image/gif`.
            const animated = mimetype.startsWith('video/') || mimetype === 'image/gif';
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
        timeoutMs: TIMEOUT_MS,
        run: async (ctx, plugin) => {
          const m = plugin.plugin.messages;
          if (!plugin.capabilities.has('send.image')) return m.unsupported;
          const source = pickMedia(ctx.message, (msg) => msg.type === 'sticker');
          if (!source) return usage(ctx, plugin, m.imageUsage);
          return attempt(ctx, plugin, async () => {
            const png = await stickerToPng(await source.media.download());
            await ctx.reply.image(png, { caption: m.imageDone, mimetype: 'image/png' });
          });
        },
      },

      gif: {
        aliases: ['g'],
        description: 'Figurinha animada → GIF',
        timeoutMs: TIMEOUT_MS,
        run: async (ctx, plugin) => {
          const m = plugin.plugin.messages;
          if (!plugin.capabilities.has('send.video')) return m.unsupported;
          const source = pickMedia(ctx.message, (msg) => msg.type === 'sticker');
          if (!source) return usage(ctx, plugin, m.gifUsage);
          let reply: string | undefined;
          const failed = await attempt(ctx, plugin, async () => {
            const sticker = await source.media.download();
            if (!(await isAnimated(sticker))) {
              reply = m.gifStatic;
              return;
            }
            const mp4 = await stickerToMp4(sticker, ctx.signal);
            await ctx.reply.video(mp4, { caption: m.gifDone, mimetype: 'video/mp4' });
          });
          return failed ?? reply;
        },
      },

      pdf: {
        description: 'Imagem → PDF (`!pdf nome do arquivo`)',
        timeoutMs: TIMEOUT_MS,
        run: async (ctx, plugin) => {
          const m = plugin.plugin.messages;
          if (!plugin.capabilities.has('send.document')) return m.unsupported;
          const source = pickMedia(ctx.message, (msg) => msg.type === 'image');
          if (!source) return usage(ctx, plugin, m.pdfUsage);
          return attempt(ctx, plugin, async () => {
            const pdf = await imageToPdf(await source.media.download());
            await ctx.reply.document(pdf, {
              fileName: pdfFileName(ctx.rawArgs, 'imagem.pdf'),
              mimetype: PDF_MIMETYPE,
            });
          });
        },
      },

      mergepdf: {
        aliases: ['joinpdf'],
        description: 'Junta PDFs: adicione um por vez, `done nome` finaliza, `clear` cancela',
        timeoutMs: TIMEOUT_MS,
        run: async (ctx, plugin) => {
          const m = plugin.plugin.messages;
          if (!plugin.capabilities.has('send.document')) return m.unsupported;
          const key = `${ctx.message.chat.id}:${ctx.message.sender.id}`;
          dropExpired(merges);
          const [action = '', ...rest] = ctx.args;

          if (/^(clear|limpar|cancelar)$/i.test(action)) {
            merges.delete(key);
            return m.mergeCleared;
          }

          if (/^(done|pronto|finalizar)$/i.test(action)) {
            const pending = merges.get(key);
            if (!pending || pending.pdfs.length < 2) return m.mergeNeedMore;
            const failed = await attempt(ctx, plugin, async () => {
              await ctx.reply.document(await mergePdfs(pending.pdfs), {
                fileName: pdfFileName(rest.join(' '), 'pdf-juntado.pdf'),
                mimetype: PDF_MIMETYPE,
              });
            });
            // Falhou: a lista fica, para a pessoa tentar de novo ou limpar.
            if (!failed) merges.delete(key);
            return failed;
          }

          const source = pickMedia(
            ctx.message,
            (msg) => msg.type === 'document' && msg.media.mimetype === PDF_MIMETYPE,
          );
          if (!source) return m.mergeUsage;
          const pending = merges.get(key) ?? { pdfs: [], bytes: 0, expiresAt: 0 };
          // Com o tamanho informado, recusa antes de baixar.
          if (pending.bytes + (source.media.size ?? 0) > MERGE_MAX_BYTES) return m.mergeFull;
          let reply: string | undefined;
          const failed = await attempt(ctx, plugin, async () => {
            const pdf = await source.media.download();
            if (pending.bytes + pdf.length > MERGE_MAX_BYTES) {
              reply = m.mergeFull;
              return;
            }
            pending.pdfs.push(pdf);
            pending.bytes += pdf.length;
            pending.expiresAt = Date.now() + MERGE_TTL_MS;
            merges.set(key, pending);
            reply = `${m.mergeAdded} (${pending.pdfs.length}).`;
          });
          return failed ?? reply;
        },
      },
    },
  });
}

/** Mídia da própria mensagem ou, na falta, da citada, se `accept` aceitar. */
function pickMedia(message: Message, accept: (msg: MediaMessage) => boolean): MediaMessage | null {
  for (const msg of [message, message.quoted]) {
    if (msg && 'media' in msg && accept(msg)) return msg;
  }
  return null;
}

/**
 * Roda a conversão entre as reações de andamento (⏳, ✅ ou ❌). Devolve o texto de erro para
 * o comando responder, ou `undefined` se deu certo.
 */
async function attempt(
  ctx: CommandContext,
  plugin: Plugin,
  work: () => Promise<void>,
): Promise<string | undefined> {
  await react(ctx, plugin.capabilities, '⏳');
  try {
    await work();
  } catch (err) {
    ctx.log.error('falha ao processar mídia', { err });
    await react(ctx, plugin.capabilities, '❌');
    return err instanceof UrlFetchError
      ? plugin.plugin.messages.urlError
      : plugin.plugin.messages.conversionError;
  }
  await react(ctx, plugin.capabilities, '✅');
  return undefined;
}

async function usage(ctx: CommandContext, plugin: Plugin, text: string): Promise<string> {
  await react(ctx, plugin.capabilities, '❌');
  return text;
}

/** Reação é enfeite: sem a capability, o comando segue só com as respostas. */
async function react(
  ctx: CommandContext,
  capabilities: ReadonlySet<Capability>,
  emoji: string,
): Promise<void> {
  if (capabilities.has('reactions')) await ctx.react(emoji);
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
