import {
  definePlugin,
  type Media,
  MediaExpiredError,
  type Message,
  type PluginDefinition,
} from '@usebridger/core';
import { APICallError, generateImage } from 'ai';
import sharp from 'sharp';
import { z } from 'zod';
import { type ActionSpec, trackerFor } from '#plugins/action-metrics.ts';
import { isContentFlagged } from '#plugins/ai/ai.ts';
import { aiTool, fail, ok } from '#plugins/ai/tools.ts';
import type { ChatMediaLookup } from '#plugins/ai-context/media.ts';
import { attempt, usage } from '#plugins/media-command.ts';
import { clearBackground, hasTransparency, onWhite } from './background.ts';
import {
  IMAGE_MODEL_FAILED,
  STICKER_EDIT_DONE,
  STICKER_EDIT_FAILED,
  STICKER_EDIT_REFUSED,
} from './log-events.ts';

/** A figurinha passa do que o plugin manda ao modelo (`maxBytes`). */
export class StickerTooLargeError extends Error {
  override readonly name = 'StickerTooLargeError';
}

/** Nenhum modelo da cadeia editou: cota do dia esgotada, sem chave... (o último erro no `cause`). */
export class StickerEditUnavailableError extends Error {
  override readonly name = 'StickerEditUnavailableError';
}

/**
 * O filtro de conteúdo recusou a edição em todo modelo que a tentou: personagem famoso, pessoa real
 * ou pedido barrado. Repetir o mesmo pedido não adianta (o último erro no `cause`).
 */
export class StickerEditFlaggedError extends Error {
  override readonly name = 'StickerEditFlaggedError';
}

export interface EditedSticker {
  /** Figurinha pronta (WebP com o pacote), feita pelo serviço `sticker`. */
  readonly sticker: Buffer;
  /** O item da cadeia que editou, como `cloudflare:flux-2-klein-4b`. */
  readonly model: string;
}

export interface StickerEditService {
  /**
   * Edita a figurinha conforme o pedido, percorrendo a cadeia de modelos de imagem. Lança
   * `StickerTooLargeError`, `StickerEditFlaggedError` e `StickerEditUnavailableError`.
   */
  edit(sticker: Buffer, request: string, options: EditOptions): Promise<EditedSticker>;
}

export interface EditOptions {
  readonly signal: AbortSignal;
  /** Imagens de referência (o rosto, o objeto...), depois da figurinha; até três. */
  readonly references?: readonly Buffer[];
}

declare module '@usebridger/core' {
  interface Services {
    stickerEdit: StickerEditService;
  }
}

const MESSAGES = {
  usage:
    'ℹ️ Responda a uma figurinha com {prefix}editar <o que mudar>. Para usar uma foto de referência, responda à figurinha com a foto e o {prefix}editar na legenda',
  viewOnce: 'ℹ️ Não edito mídia de visualização única.',
  conversionError: '⚠️ Não consegui editar essa figurinha agora. Tenta de novo mais tarde.',
  tooLarge: '⚠️ Essa figurinha é grande demais para editar.',
  flagged:
    '🚫 O modelo recusou editar essa figurinha (filtro de conteúdo). Personagens famosos e pessoas reais costumam ser barrados: tenta outra figurinha ou outro pedido.',
};

/**
 * Só modelo grátis por padrão: o klein 4B do Cloudflare custa ~31 neurons numa figurinha 512×512,
 * umas 300 edições nos 10.000 diários do plano grátis, que recusa em vez de cobrar. Gemini e
 * OpenAI ficam de fora porque cobram (ver docs/sticker-edit.md).
 */
const DEFAULT_MODELS = ['cloudflare:flux-2-klein-4b'];

const config = z.object({
  /** Cadeia de modelos de imagem (`provider:modelo`), em ordem. Usa as chaves dos providers. */
  models: z
    .array(z.string().regex(/^[a-z0-9-]+:.+$/, 'use provider:modelo'))
    .min(1)
    .default(DEFAULT_MODELS),
  /** Figurinha acima disso não vai ao modelo. */
  maxBytes: z
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),
  /** Por tentativa: um modelo travado não segura a cadeia. */
  timeoutMs: z.number().int().positive().default(60_000),
  /** Quanto tempo um modelo que respondeu 429 (cota do dia) vai para o fim da cadeia. */
  cooldownMs: z
    .number()
    .int()
    .nonnegative()
    .default(30 * 60_000),
});

/** Prazo do comando: a cadeia pode passar por mais de um modelo. */
const COMMAND_TIMEOUT_MS = 120_000;

/** O modelo aceita quatro imagens: a figurinha e até três referências. */
const MAX_REFERENCES = 3;

/**
 * O pedido vai como veio (o `!editar` traz o texto da pessoa; a tool, o que a Luma escreveu), com
 * a instrução de não refazer a figurinha inteira. Com referência, o prompt diz qual imagem é a
 * figurinha: a ordem das imagens é a única pista que o modelo tem.
 */
export const promptFor = (request: string, references: number) =>
  (references === 0
    ? `Edit this sticker image as requested: ${request}\n`
    : 'The first image is the sticker to edit. ' +
      (references === 1
        ? 'The second image is a reference (a person, object or style to use). '
        : 'The other images are references (people, objects or styles to use). ') +
      `Edit the sticker as requested: ${request}\n`) +
  'Keep everything else (subject, framing, art style, background) as close to the original sticker as possible.';

/** Uma mídia de edição: a figurinha ou uma referência, com o que a mensagem diz dela. */
interface Source {
  readonly media: Media;
  readonly isViewOnce: boolean;
}

/** A mídia da mensagem, se for de um dos `types`. */
function mediaIn(message: Message | null | undefined, types: readonly string[]): Source | null {
  return message && 'media' in message && types.includes(message.type) ? message : null;
}

/**
 * Figurinha e referências de uma mensagem. Respondendo a uma figurinha, ela é o alvo e a imagem ou
 * figurinha da própria mensagem vira referência; sem citada, a figurinha da mensagem é o alvo.
 */
export function editSources(message: Message): { target: Source; references: Source[] } | null {
  const quoted = mediaIn(message.quoted, ['sticker']);
  const own = mediaIn(message, ['image', 'sticker']);
  if (quoted) return { target: quoted, references: own ? [own] : [] };
  return own && message.type === 'sticker' ? { target: own, references: [] } : null;
}

/** Por que um ID da conversa não serve para a edição; vai ao modelo como `error`, com o ID. */
type IdRefusal =
  | 'no-history'
  | 'no-sticker'
  | 'unknown'
  | 'no-media'
  | 'view-once'
  | 'not-sticker'
  | 'not-image';

/**
 * Figurinha e referências escolhidas pela Luma por ID da transcrição (`#m12`), para usar mídias
 * anteriores do chat. Sem `target`, vale a da mensagem (ou da citada); sem `references`, a foto ou
 * figurinha da própria mensagem, se houver. Precisa do serviço `aiContext`, que guarda a transcrição.
 */
export function sourcesById(
  message: Message,
  ids: {
    readonly target?: string | undefined;
    readonly references?: readonly string[] | undefined;
  },
  lookup: ((chatId: string, id: string) => ChatMediaLookup) | undefined,
): { target: Source; references: Source[] } | { refused: IdRefusal; id?: string } {
  if (!lookup) return { refused: 'no-history' };
  const resolve = (
    id: string,
    types: readonly string[],
  ): Source | { refused: IdRefusal; id: string } => {
    const found = lookup(message.chat.id, id);
    if (!found.found) return { refused: found.reason, id };
    if (!types.includes(found.type)) {
      return { refused: types.length === 1 ? 'not-sticker' : 'not-image', id };
    }
    return { media: found.media, isViewOnce: false };
  };

  const base = editSources(message);
  let target = base?.target;
  if (ids.target) {
    const r = resolve(ids.target, ['sticker']);
    if ('refused' in r) return r;
    target = r;
  }
  if (!target) return { refused: 'no-sticker' };

  let references: Source[];
  if (ids.references) {
    references = [];
    for (const id of ids.references) {
      const r = resolve(id, ['image', 'sticker']);
      if ('refused' in r) return r;
      references.push(r);
    }
  } else if (ids.target) {
    // Alvo por ID: a mídia da própria mensagem (a foto do rosto, por exemplo) é a referência.
    const own = mediaIn(message, ['image', 'sticker']);
    references = own ? [own] : [];
  } else {
    references = base?.references ?? [];
  }
  return { target, references };
}

/** Baixa as mídias de `editSources` para o serviço. */
async function download(sources: { target: Source; references: Source[] }) {
  const [sticker, ...references] = await Promise.all(
    [sources.target, ...sources.references].map((s) => s.media.download()),
  );
  return { sticker: sticker as Buffer, references };
}

/**
 * Cada edição (do comando, da tool ou de outro plugin pelo serviço) no log (`sticker-edit.edit.*`)
 * e em `luma_sticker_edit_*`. Um `kind` só, `sticker`, para seguir a convenção.
 */
const ACTION: ActionSpec = {
  metric: 'sticker_edit',
  help: 'Edições de figurinha por IA',
  buckets: [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120],
  events: { done: STICKER_EDIT_DONE, refused: STICKER_EDIT_REFUSED, failed: STICKER_EDIT_FAILED },
  refusal: (err) => {
    if (err instanceof StickerTooLargeError) return 'too-large';
    if (err instanceof StickerEditUnavailableError) return 'unavailable';
    if (err instanceof StickerEditFlaggedError) return 'flagged';
    return undefined;
  },
};

/**
 * Edição de figurinha por IA: `!editar` e a tool `edit_sticker`. A Luma (DeepSeek ou outro)
 * entende o pedido e chama a tool; quem altera os pixels é a cadeia de modelos de imagem desta
 * config, e a figurinha final sai pelo serviço `sticker`.
 */
export const stickerEdit: PluginDefinition = definePlugin({
  name: 'sticker-edit',
  version: '0.1.0',
  engine: '<1.0.0',
  requires: ['media.download', 'send.sticker'],
  dependsOn: { ai: '^0.1.0', sticker: '^1.0.0' },
  // Opcional: sem o `metrics` as edições seguem, só com o log.
  optionalDependsOn: { metrics: '*' },
  config,
  messages: MESSAGES,
  setup: (ctx) => {
    const { models, maxBytes, timeoutMs, cooldownMs } = ctx.config;
    const providers = ctx.services.extensionPoint('ai.providers');
    const stickers = ctx.services.get('sticker');
    // Modelo → fim do cooldown. Em memória: um restart zera, o que só custa uma tentativa.
    const coolingUntil = new Map<string, number>();

    const service: StickerEditService = {
      async edit(sticker, request, { signal, references = [] }) {
        const refs = references.slice(0, MAX_REFERENCES);
        if ([sticker, ...refs].some((b) => b.length > maxBytes)) throw new StickerTooLargeError();
        // PNG do primeiro quadro sobre branco: figurinha animada sai estática, e o modelo, que
        // devolve JPEG, recebe e devolve o fundo branco que `clearBackground` sabe tirar. A foto
        // de referência é desvirada pelo EXIF, senão o rosto chega deitado.
        const [transparent, png, ...refPngs] = await Promise.all([
          hasTransparency(sticker),
          onWhite(sticker),
          ...refs.map((r) => sharp(r).rotate().png().toBuffer()),
        ]);
        const now = Date.now();
        const cooling = (m: string) => (coolingUntil.get(m) ?? 0) > now;
        // Em cooldown vai para o fim, não sai: com todos em 429, ainda vale tentar.
        const order = [...models.filter((m) => !cooling(m)), ...models.filter(cooling)];
        const registered = providers.list();

        let lastError: unknown;
        let flagged = false;
        for (const model of order) {
          const sep = model.indexOf(':');
          const provider = registered.find((p) => p.name === model.slice(0, sep));
          // Sem chave ou sem modelo de imagem (Claude, DeepSeek): pula sem chamar.
          if (!provider?.imageModel) continue;
          try {
            const result = await generateImage({
              model: provider.imageModel(model.slice(sep + 1)),
              prompt: {
                images: [png as Buffer, ...refPngs],
                text: promptFor(request, refPngs.length),
              },
              n: 1,
              // O fallback é a cadeia; o retry do SDK gastaria cota no mesmo modelo.
              maxRetries: 0,
              abortSignal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
            });
            coolingUntil.delete(model);
            const raw = Buffer.from(result.image.uint8Array);
            // Figurinha recortada volta recortada; a que já tinha fundo fica com o dela.
            const edited = transparent ? await clearBackground(raw) : raw;
            return {
              sticker: await stickers.create(edited, { animated: false, text: '', signal }),
              model,
            };
          } catch (err) {
            if (signal.aborted) throw err;
            // Diferente do texto, qualquer erro passa adiante: cota esgotada, modelo que a chave
            // não acessa e recusa de conteúdo variam de um modelo para outro.
            if (APICallError.isInstance(err) && err.statusCode === 429) {
              coolingUntil.set(model, Date.now() + cooldownMs);
            }
            flagged ||= isContentFlagged(err);
            ctx.log.event(IMAGE_MODEL_FAILED, { model, err });
            lastError = err;
          }
        }
        // Um modelo que barrou o conteúdo explica a falha melhor que a cota de outro.
        if (flagged) {
          throw new StickerEditFlaggedError('o filtro de conteúdo recusou a edição', {
            cause: lastError,
          });
        }
        throw new StickerEditUnavailableError('nenhum modelo de imagem editou', {
          cause: lastError,
        });
      },
    };
    ctx.services.provide('stickerEdit', service);
    const track = trackerFor(ACTION, ctx.services);

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'edit_sticker',
        description:
          'Edita com IA uma figurinha e envia a figurinha editada no chat. Use quando pedirem para mudar, adicionar ou tirar algo de uma figurinha, ou para juntar figurinhas. Sem IDs, edita a figurinha da mensagem do usuário ou da que ele respondeu; se ele respondeu à figurinha mandando uma foto ou outra figurinha, ela vai junto como referência (o rosto de alguém, um objeto, um estilo). Para usar figurinhas ou fotos mandadas antes no chat, passe os IDs da conversa: `target` é a figurinha que vai ser editada (a base) e `references` são as que dão o que usar. Ex.: "a cabeça do cara da primeira figurinha no corpo do cara da segunda" → `target` = a segunda, `references` = [a primeira]. No `request`, chame a base de "the sticker" e as referências de "the reference image" (ou "the first/second reference image"). `request` é o pedido, detalhado e em inglês. Só edita figurinha, não foto. Com `error: flagged`, o filtro de conteúdo do modelo recusou (personagem famoso, pessoa real): conte isso ao usuário e sugira outra figurinha ou outro pedido. Com `error: expired`, a mídia não está mais disponível no WhatsApp.',
        args: z.object({
          request: z
            .string()
            .min(1)
            .describe('O que mudar, detalhado e em inglês (ex.: "add a red party hat")'),
          target: z
            .string()
            .optional()
            .describe(
              'ID da conversa (#m12) da figurinha a editar, se não for a da mensagem nem a citada',
            ),
          references: z
            .array(z.string())
            .max(MAX_REFERENCES)
            .optional()
            .describe(
              'IDs da conversa (#m12) das imagens ou figurinhas de referência, na ordem do pedido',
            ),
        }),
        run: async ({ request, target, references: referenceIds }, t) => {
          let sources: { target: Source; references: Source[] } | null;
          if (target || referenceIds) {
            const lookup = ctx.services.has('aiContext')
              ? ctx.services.get('aiContext').media
              : undefined;
            const byId = sourcesById(t.message, { target, references: referenceIds }, lookup);
            if ('refused' in byId) return fail(byId.refused, byId.id);
            sources = byId;
          } else {
            sources = editSources(t.message);
          }
          if (!sources) return fail('no-sticker');
          if ([sources.target, ...sources.references].some((s) => s.isViewOnce)) {
            return fail('view-once');
          }
          try {
            const model = await track(t, 'sticker', async (step) => {
              const { sticker, references } = await download(sources);
              const edited = await service.edit(sticker, request, { signal: t.signal, references });
              await t.reply.sticker(edited.sticker);
              step.note({
                model: edited.model,
                bytes: edited.sticker.length,
                references: references.length,
              });
              return edited.model;
            });
            return ok({ model });
          } catch (err) {
            if (err instanceof StickerTooLargeError) return fail('too-large');
            if (err instanceof StickerEditUnavailableError) return fail('unavailable');
            if (err instanceof StickerEditFlaggedError) return fail('flagged');
            // Mídia anterior que saiu da plataforma: o download pela referência não tem volta.
            if (err instanceof MediaExpiredError) return fail('expired');
            throw err;
          }
        },
      }),
    );
  },
  commands: {
    editar: {
      aliases: ['edit'],
      description: 'Edita uma figurinha com IA: responda a ela com `!editar <o que mudar>`',
      accepts: ['sticker', 'quoted:sticker'],
      onReject: usage('usage'),
      timeoutMs: COMMAND_TIMEOUT_MS,
      background: true,
      run: async (ctx, plugin) => {
        const request = ctx.rawArgs.replace(/\s+/g, ' ').trim();
        // Pela mensagem, não pelo `ctx.media`: a referência é a mídia da própria mensagem, que o
        // `accepts` não escolhe quando a figurinha é a citada.
        const sources = editSources(ctx.message);
        if (!sources || !request) return usage('usage')(ctx);
        if ([sources.target, ...sources.references].some((s) => s.isViewOnce)) {
          return usage('viewOnce')(ctx);
        }
        const track = trackerFor(ACTION, plugin.services);
        return attempt(
          ctx,
          track,
          'sticker',
          async (step) => {
            const { sticker, references } = await download(sources);
            const edited = await plugin.services
              .get('stickerEdit')
              .edit(sticker, request, { signal: ctx.signal, references });
            await ctx.reply.sticker(edited.sticker);
            step.note({
              model: edited.model,
              bytes: edited.sticker.length,
              references: references.length,
            });
          },
          (err) => {
            if (err instanceof StickerTooLargeError) return 'tooLarge';
            if (err instanceof StickerEditFlaggedError) return 'flagged';
            return 'conversionError';
          },
        );
      },
    },
  },
});
