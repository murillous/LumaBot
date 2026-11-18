// Mídia da transcrição pelo ID (`#m12`): guardar de onde baixar quando a fala chega, achar depois
// sem a mensagem, e a tool `view_media`, o "Read" da Luma para olhar uma figurinha ou foto anterior.

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
import { type AiTool, aiTool, fail, ok } from '#plugins/ai-tools.ts';
import { personId } from '#plugins/person-id.ts';
import type { MediaFile, Transcript } from './transcript.ts';

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
/** Quantas mídias a Luma olha de uma vez. */
const MAX_VIEW = 4;
const VIEWABLE: readonly MessageType[] = ['image', 'sticker'];

const DESCRIBE = `Você descreve imagens de um chat de WhatsApp para alguém que não consegue vê-las.
Para cada imagem, rotulada com o ID dela, diga de forma objetiva e curta: o que e quem aparece (pessoas, roupas, poses, expressões), o texto escrito nela, o estilo (foto, desenho, meme) e a emoção que passa.
Se houver uma pergunta, responda a ela também. Responda em português.`;

interface ViewDeps {
  readonly transcript: Transcript;
  readonly refs: MediaRefs;
  readonly ai: AiService;
  /** Cadeia que enxerga; vazia usa a principal. */
  readonly models: readonly ModelChainItem[];
}

/**
 * `view_media`: a Luma olha mídias anteriores do chat pelo ID. Quem enxerga é a cadeia de visão,
 * numa chamada à parte que devolve a descrição em texto: o modelo da conversa pode não ter visão
 * (o DeepSeek), e a imagem não fica pesando nos passos seguintes.
 */
export function viewMediaTool({ transcript, refs, ai, models }: ViewDeps): AiTool {
  return aiTool({
    name: 'view_media',
    description:
      'Olha imagens ou figurinhas que já foram mandadas neste chat, pelo ID da conversa (#m12), e devolve a descrição delas. Use quando precisar ver uma mídia anterior para responder ou para escolher qual usar (ex.: "o que tinha naquela figurinha?", "qual das duas é o cara de terno?"). A imagem da mensagem atual (ou da citada) você já vê, sem precisar desta ferramenta.',
    args: z.object({
      ids: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_VIEW)
        .describe('IDs das mensagens com a mídia, como aparecem na conversa (ex.: ["#m3", "#m5"])'),
      question: z
        .string()
        .optional()
        .describe('O que você quer saber das imagens, se algo específico'),
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
        const label = found.type === 'sticker' ? 'figurinha' : 'imagem';
        parts.push(
          { type: 'text', text: `${id.startsWith('#') ? id : `#${id}`} (${label}):` },
          { type: 'file', data, mediaType: media.mimetype.split(';')[0] ?? media.mimetype },
        );
      }
      if (question) parts.push({ type: 'text', text: `Pergunta: ${question}` });
      const { text } = await ai.generate({
        purpose: 'ai-context.view',
        instructions: DESCRIBE,
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
