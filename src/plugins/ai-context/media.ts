// Mídia da transcrição pelo ID (`#m12`): guardar de onde baixar quando a fala chega, achar depois
// sem a mensagem, e a tool `view_media`, o "Read" do bot para olhar uma figurinha ou foto anterior.

import {
  type Capability,
  type Media,
  MediaExpiredError,
  type MediaRefs,
  type Message,
  type MessageType,
  UnsupportedError,
} from '@usebridger/core';
import type { FilePart, TextPart } from 'ai';
import { z } from 'zod';
import type { AiService, ModelChainItem } from '#plugins/ai/ai.ts';
import { personId } from '#plugins/ai/person-id.ts';
import { type AiTool, aiTool, fail, ok } from '#plugins/ai/tools.ts';
import { DEFAULT_SPEECH, fill, type Speech } from './texts.ts';
import { kindLabel, type MediaFile, type Transcript } from './transcript.ts';

/** O que um plugin acha pelo ID de uma fala do chat. */
export type ChatMediaLookup =
  | { readonly found: true; readonly type: MessageType; readonly media: Media }
  | { readonly found: false; readonly reason: 'unknown' | 'no-media' | 'view-once' };

/**
 * De onde baixar a mídia da mensagem depois. Com `media.ref`, a referência do kernel, que o
 * transport baixa de novo sem a mensagem; sem ela (ou se o transport não deu referência a esta
 * mídia), a própria `Media`, lazy, enquanto a fala estiver na transcrição. Visualização única
 * não é guardada: quem mandou escolheu que ela não fique.
 */
export function fileOf(
  message: Message,
  refs: MediaRefs,
  capabilities: ReadonlySet<Capability>,
): MediaFile | undefined {
  if (!('media' in message) || message.isViewOnce) return undefined;
  if (capabilities.has('media.ref')) {
    try {
      return { type: message.type, ref: refs.ref(message.media) };
    } catch (err) {
      // Mídia sem referência no transport: a `Media` em memória ainda serve pelas 2 h.
      if (!(err instanceof UnsupportedError)) throw err;
    }
  }
  return { type: message.type, live: message.media };
}

/** A mídia da fala `id` do chat, pronta para baixar. */
export function lookupMedia(
  transcript: Transcript,
  refs: MediaRefs,
  chatId: string,
  id: string,
): ChatMediaLookup {
  const entry = transcript.get(chatId, id);
  if (!entry) return { found: false, reason: 'unknown' };
  if (!entry.media) return { found: false, reason: 'no-media' };
  if (!entry.file) return { found: false, reason: 'view-once' };
  const media = 'ref' in entry.file ? refs.fromRef(entry.file.ref) : entry.file.live;
  return { found: true, type: entry.file.type, media };
}

/** Imagem maior que isso não vai ao modelo: estoura o corpo da requisição e custa caro. */
const MAX_VIEW_BYTES = 8 * 1024 * 1024;
/** Quantas mídias o bot olha de uma vez. */
const MAX_VIEW = 4;
const VIEWABLE: readonly MessageType[] = ['image', 'sticker'];

interface ViewDeps {
  readonly transcript: Transcript;
  readonly refs: MediaRefs;
  readonly ai: AiService;
  /** Cadeia que enxerga; vazia usa a principal. */
  readonly models: readonly ModelChainItem[];
  readonly speech?: Speech;
}

/**
 * `view_media`: o bot olha mídias anteriores do chat pelo ID. Quem enxerga é a cadeia de visão,
 * numa chamada à parte que devolve a descrição em texto: o modelo da conversa pode não ter visão
 * (o DeepSeek), e a imagem não fica pesando nos passos seguintes.
 */
export function viewMediaTool({
  transcript,
  refs,
  ai,
  models,
  speech = DEFAULT_SPEECH,
}: ViewDeps): AiTool {
  const { texts } = speech;
  return aiTool({
    name: 'view_media',
    description: texts.toolViewMedia,
    args: z.object({
      ids: z.array(z.string().min(1)).min(1).max(MAX_VIEW).describe(texts.toolViewMediaIds),
      question: z.string().optional().describe(texts.toolViewMediaQuestion),
    }),
    requires: ['media.download'],
    sideEffects: false,
    run: async ({ ids, question }, t) => {
      const chatId = t.message.chat.id;
      const parts: (TextPart | FilePart)[] = [];
      for (const id of ids) {
        const found = lookupMedia(transcript, refs, chatId, id);
        if (!found.found) return fail(found.reason, id);
        if (!VIEWABLE.includes(found.type)) return fail('not-image', id);
        const { media } = found;
        if (media.size !== null && media.size > MAX_VIEW_BYTES) return fail('too-large', id);
        let data: Buffer;
        try {
          data = await media.download();
        } catch (err) {
          if (err instanceof MediaExpiredError) return fail('expired', id);
          throw err;
        }
        const label = kindLabel(found.type === 'sticker' ? 'sticker' : 'image', speech);
        const ref = id.startsWith('#') ? id : `#${id}`;
        parts.push(
          { type: 'text', text: fill(texts.viewLabel, { id: ref, kind: label }) },
          { type: 'file', data, mediaType: media.mimetype.split(';')[0] ?? media.mimetype },
        );
      }
      if (question) parts.push({ type: 'text', text: fill(texts.question, { question }) });
      const { text } = await ai.generate({
        purpose: 'ai-context.view',
        instructions: texts.viewInstructions,
        messages: [{ role: 'user', content: parts }],
        signal: t.signal,
        // O custo da olhada entra no uso de quem pediu, como a resposta.
        actor: { id: personId(t.message.sender), chatId },
        ...(models.length > 0 && { models }),
      });
      return ok({ description: text });
    },
  });
}
