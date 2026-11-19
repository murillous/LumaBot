// A tool `listen_audio`: o "ouvido" do bot para áudios anteriores do chat, pelo ID, como o
// `view_media` é para as imagens e o `read_pdf` para os PDFs.

import { MediaExpiredError, type MediaRefs, type MessageType } from '@usebridger/core';
import type { FilePart, TextPart } from 'ai';
import { z } from 'zod';
import type { AiService, ModelChainItem } from '#plugins/ai/ai.ts';
import { personId } from '#plugins/ai/person-id.ts';
import { type AiTool, aiTool, fail, ok } from '#plugins/ai/tools.ts';
import { lookupMedia } from './media.ts';
import { DEFAULT_SPEECH, fill, type Speech } from './texts.ts';
import { kindLabel, type Transcript } from './transcript.ts';

/** Quantos áudios o bot ouve de uma vez. */
const MAX_LISTEN = 4;
const AUDIBLE: readonly MessageType[] = ['audio', 'voice'];

/** O tipo que os providers aceitam: `audio/mpeg` vira `audio/mp3`, e o desconhecido, ogg (PTT). */
export function audioMediaType(mimetype: string): string {
  const base = (mimetype.split(';')[0] ?? '').trim().toLowerCase();
  if (base === 'audio/mpeg') return 'audio/mp3';
  return base.startsWith('audio/') ? base : 'audio/ogg';
}

interface ListenDeps {
  readonly transcript: Transcript;
  readonly refs: MediaRefs;
  readonly ai: AiService;
  /** Cadeia que ouve; vazia usa a principal. */
  readonly models: readonly ModelChainItem[];
  /** Áudio maior que isso não vai ao modelo. */
  readonly maxBytes: number;
  readonly speech?: Speech;
}

/**
 * `listen_audio`: o bot ouve áudios anteriores do chat pelo ID. Quem ouve é a cadeia de áudio,
 * numa chamada à parte que devolve o que foi dito em texto: o modelo da conversa pode não ouvir
 * (o DeepSeek), e o áudio não fica pesando nos passos seguintes.
 */
export function listenAudioTool({
  transcript,
  refs,
  ai,
  models,
  maxBytes,
  speech = DEFAULT_SPEECH,
}: ListenDeps): AiTool {
  const { texts } = speech;
  return aiTool({
    name: 'listen_audio',
    description: texts.toolListenAudio,
    args: z.object({
      ids: z.array(z.string().min(1)).min(1).max(MAX_LISTEN).describe(texts.toolListenAudioIds),
      question: z.string().optional().describe(texts.toolListenAudioQuestion),
    }),
    requires: ['media.download'],
    sideEffects: false,
    run: async ({ ids, question }, t) => {
      const chatId = t.message.chat.id;
      const parts: (TextPart | FilePart)[] = [];
      for (const id of ids) {
        const found = lookupMedia(transcript, refs, chatId, id);
        if (!found.found) return fail(found.reason, id);
        if (!AUDIBLE.includes(found.type)) return fail('not-audio', id);
        const { media } = found;
        if (media.size !== null && media.size > maxBytes) return fail('too-large', id);
        let data: Buffer;
        try {
          data = await media.download();
        } catch (err) {
          if (err instanceof MediaExpiredError) return fail('expired', id);
          throw err;
        }
        // O tamanho declarado pode faltar: confere de novo depois de baixar.
        if (data.length > maxBytes) return fail('too-large', id);
        const ref = id.startsWith('#') ? id : `#${id}`;
        parts.push(
          {
            type: 'text',
            text: fill(texts.viewLabel, { id: ref, kind: kindLabel('audio', speech) }),
          },
          { type: 'file', data, mediaType: audioMediaType(media.mimetype) },
        );
      }
      if (question) parts.push({ type: 'text', text: fill(texts.question, { question }) });
      const { text } = await ai.generate({
        purpose: 'ai-context.listen',
        instructions: texts.listenInstructions,
        messages: [{ role: 'user', content: parts }],
        signal: t.signal,
        // O custo de ouvir entra no uso de quem pediu, como a resposta.
        actor: { id: personId(t.message.sender), chatId },
        ...(models.length > 0 && { models }),
      });
      return ok({ transcript: text });
    },
  });
}
