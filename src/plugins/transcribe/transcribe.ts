import { definePlugin, fmt, italic, type Media, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { type ActionSpec, trackerFor } from '#plugins/action-metrics.ts';
import { AiUnavailableError, chainItem } from '#plugins/ai/ai.ts';
import { aiTool, fail, mediaMessage, ok } from '#plugins/ai-tools.ts';
import { mediaOf } from '#plugins/media-command.ts';
import { TRANSCRIBE_DONE, TRANSCRIBE_FAILED, TRANSCRIBE_REFUSED } from './log-events.ts';

/** O que o modelo devolve quando não há fala a transcrever; o comando os traduz para o usuário. */
export const UNINTELLIGIBLE = '[áudio ininteligível]';
export const SILENT = '[áudio sem conteúdo]';

/** O áudio passa do que o plugin manda ao modelo (`maxBytes`). */
export class AudioTooLargeError extends Error {
  override readonly name = 'AudioTooLargeError';
}

export interface TranscriptionService {
  /**
   * Transcreve o áudio (`voice` ou `audio`) e devolve o texto, ou {@link UNINTELLIGIBLE} /
   * {@link SILENT} quando não há fala. Lança `AudioTooLargeError` e `AiUnavailableError`.
   */
  transcribe(media: Media, options?: { signal?: AbortSignal }): Promise<string>;
}

declare module '@usebridger/core' {
  interface Services {
    transcription: TranscriptionService;
  }
}

const MESSAGES = {
  usage: 'ℹ️ Responda a um áudio com {prefix}transcribe (ou {prefix}t)',
  failed: '⚠️ Não consegui transcrever esse áudio.',
  tooLarge: '⚠️ Esse áudio é grande demais para transcrever.',
  unintelligible: 'Tentei ouvir o áudio, mas não consegui entender o que foi dito.',
  silent: 'Tentei ouvir o áudio, mas ele estava vazio ou silencioso.',
};

const config = z.object({
  /**
   * Cadeia só da transcrição, no formato do `ai`. Nem todo modelo tem entrada de áudio (o DeepSeek
   * não tem): `[{ "model": "google:gemini-2.5-flash" }]` transcreve com o Gemini enquanto a Luma
   * segue na cadeia principal. Vazio usa a principal.
   */
  models: z.array(chainItem).default([]),
  /** Áudio acima disso não vai ao modelo. */
  maxBytes: z
    .number()
    .int()
    .positive()
    .default(15 * 1024 * 1024),
});

const PROMPT =
  'Transcreva exatamente o que foi dito neste áudio para texto.\n' +
  'Retorne APENAS a transcrição literal, sem comentários, sem prefixos como "Transcrição:" ou aspas.\n' +
  `Se o áudio for ininteligível ou apenas ruído, retorne exatamente: ${UNINTELLIGIBLE}\n` +
  `Se o áudio estiver vazio ou silencioso, retorne exatamente: ${SILENT}`;

/** O que a transcrição trouxe, para o log: nunca o texto. */
function resultOf(text: string): string {
  if (!text) return 'empty';
  if (text === UNINTELLIGIBLE) return 'unintelligible';
  if (text === SILENT) return 'silent';
  return 'text';
}

/** `audio/ogg; codecs=opus` → `audio/ogg`: os providers não aceitam os parâmetros do WhatsApp. */
export function audioMediaType(mimetype: string): string {
  const base = (mimetype.split(';')[0] ?? '').trim().toLowerCase();
  const known: Record<string, string> = { 'audio/mpeg': 'audio/mp3' };
  return known[base] ?? (base.startsWith('audio/') ? base : 'audio/ogg');
}

/**
 * Cada transcrição (do comando, da tool ou de outro plugin pelo serviço) no log
 * (`transcribe.audio.*`) e em `luma_transcribe_*`. Um `kind` só, `audio`, para seguir a convenção.
 */
const ACTION: ActionSpec = {
  metric: 'transcribe',
  help: 'Transcrições de áudio',
  // Até o prazo do comando (90 s): a cadeia pode cair para o próximo modelo.
  buckets: [0.5, 1, 2, 3, 5, 8, 13, 21, 34, 60, 90],
  events: { done: TRANSCRIBE_DONE, refused: TRANSCRIBE_REFUSED, failed: TRANSCRIBE_FAILED },
  refusal: (err) => {
    if (err instanceof AudioTooLargeError) return 'too-large';
    if (err instanceof AiUnavailableError) return 'unavailable';
    return undefined;
  },
};

/**
 * `!transcribe` (`!t`) e a tool `transcribe_audio`. A transcrição só aparece no chat quando alguém
 * chama o comando; quando a Luma transcreve para responder, o texto vai só ao modelo.
 */
export const transcribe: PluginDefinition = definePlugin({
  name: 'transcribe',
  version: '0.1.0',
  engine: '<1.0.0',
  requires: ['media.download'],
  dependsOn: { ai: '^0.1.0' },
  // Opcional: sem o `metrics` as transcrições seguem, só com o log.
  optionalDependsOn: { metrics: '*' },
  config,
  messages: MESSAGES,
  setup: (ctx) => {
    const ai = ctx.services.get('ai');
    const { models, maxBytes } = ctx.config;
    const track = trackerFor(ACTION, ctx.services);

    const service: TranscriptionService = {
      transcribe: (media, options) =>
        track(ctx.log, 'audio', async (step) => {
          if (media.size !== null && media.size > maxBytes) throw new AudioTooLargeError();
          const data = await media.download();
          if (data.length > maxBytes) throw new AudioTooLargeError();
          const { text } = await ai.generate({
            purpose: 'transcribe',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'file', data, mediaType: audioMediaType(media.mimetype) },
                  { type: 'text', text: PROMPT },
                ],
              },
            ],
            ...(models.length > 0 && { models }),
            ...(options?.signal && { signal: options.signal }),
          });
          const transcript = text.trim();
          step.note({ bytes: data.length, result: resultOf(transcript) });
          return transcript;
        }),
    };
    ctx.services.provide('transcription', service);

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'transcribe_audio',
        sideEffects: false,
        description:
          'Transcreve o áudio (mensagem de voz) que o usuário mandou ou o da mensagem que ele respondeu, e devolve o texto só para você ler: nada vai para o chat. Use para entender e responder a um áudio.',
        args: z.object({}),
        run: async (_, t) => {
          const source = mediaMessage(t.message, ['voice', 'audio']);
          if (!source) return fail('no-audio');
          try {
            return ok({ text: await service.transcribe(source.media, { signal: t.signal }) });
          } catch (err) {
            if (err instanceof AudioTooLargeError) return fail('too-large');
            if (err instanceof AiUnavailableError) return fail('unavailable');
            throw err;
          }
        },
      }),
    );
  },
  commands: {
    transcribe: {
      aliases: ['t'],
      description: 'Transcreve um áudio: responda a ele com `!transcribe`',
      accepts: ['voice', 'audio', 'quoted:voice', 'quoted:audio'],
      onReject: (ctx) => ctx.t('usage'),
      // A cadeia pode cair para o próximo modelo, e o áudio é pesado: passa dos 30 s padrão.
      timeoutMs: 90_000,
      run: async (c, plugin) => {
        await c.react('🎙️');
        let text: string;
        try {
          text = await plugin.services
            .get('transcription')
            .transcribe(mediaOf(c), { signal: c.signal });
        } catch (err) {
          // O serviço já registrou a falha.
          await c.react('❌');
          return c.t(err instanceof AudioTooLargeError ? 'tooLarge' : 'failed');
        }
        if (!text) {
          await c.react('❌');
          return c.t('failed');
        }
        if (text === UNINTELLIGIBLE) return fmt`🎙️ ${italic(c.t('unintelligible'))}`;
        if (text === SILENT) return fmt`🎙️ ${italic(c.t('silent'))}`;
        return fmt`🎙️ ${italic(`"${text}"`)}`;
      },
    },
  },
});
