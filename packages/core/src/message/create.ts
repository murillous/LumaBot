import { createMedia, type MediaSource } from '#message/media.ts';
import type { Media, Message, MessageOf, MessageType } from '#message/types.ts';
import { messageKey } from '#transport/message-key.ts';

/**
 * Campos com valor padrão: o transport só informa quando difere do caso comum. `fromMe` fica
 * obrigatório de propósito: esquecê-lo faria o bot responder às próprias mensagens.
 */
type DefaultedKey = 'quoted' | 'mentions' | 'isForwarded' | 'isViewOnce' | 'isEdited';

// Distributiva sobre a union: cada membro vira o seu próprio formato de entrada, então o
// discriminante `type` continua exigindo os campos específicos (ex.: `location`).
type InitOf<M> = M extends Message
  ? Omit<M, 'is' | 'key' | 'media' | 'attachments' | DefaultedKey> &
      Partial<Pick<M, DefaultedKey>> & {
        /**
         * Todas as mídias, quando há mais de uma (ADR 0065). Começa pela própria `media`; ausente,
         * vale `[media]`, ou nenhuma nos tipos sem mídia.
         */
        readonly attachments?: readonly MediaSource[];
      } & (M extends { readonly media: Media } ? { readonly media: MediaSource } : unknown)
  : never;

/**
 * Dados que o transport passa a `createMessage`. Mídia entra como `MediaSource` (o loader
 * nativo); `quoted` entra já normalizado, construído com `createMessage` também. `key` não entra:
 * é derivada dos outros campos.
 */
export type MessageInit = InitOf<Message>;

// Compartilhado por toda mensagem sem mídia: o texto não paga um array novo por mensagem.
const NO_ATTACHMENTS: readonly Media[] = Object.freeze([]);

// Uma única função compartilhada por todas as mensagens: sem closure por mensagem, e como é
// propriedade própria, sobrevive a spread (`{ ...msg }`).
function is(this: { readonly type: MessageType }, type: MessageType): boolean {
  return this.type === type;
}

/**
 * Constrói uma `Message` normalizada a partir do que o transport extraiu do formato nativo.
 * Preenche os padrões (`quoted: null`, `mentions: []`, flags `false`) e a `key`, liga `is()` e
 * embrulha a mídia em `Media` lazy com cache por mensagem.
 */
export function createMessage<I extends MessageInit>(init: I): MessageOf<I['type']> {
  const source = (init as { readonly media?: MediaSource }).media;
  const media = source === undefined ? undefined : createMedia(source);
  const attachments = attachmentsOf(init.type, media, source, init.attachments);
  // `??` em vez de padrões antes do spread: um `undefined` explícito do transport também
  // recebe o padrão.
  const message = {
    ...init,
    key: messageKey(init),
    quoted: init.quoted ?? null,
    mentions: init.mentions ?? [],
    isForwarded: init.isForwarded ?? false,
    isViewOnce: init.isViewOnce ?? false,
    isEdited: init.isEdited ?? false,
    ...(media === undefined ? null : { media }),
    attachments,
    is,
  };
  return message as unknown as MessageOf<I['type']>;
}

/**
 * A lista de anexos com a `media` na frente, como o mesmo objeto (o cache de download é um só).
 * Lança `TypeError` se a lista do transport não começar pela `media` ou trouxer anexo num tipo
 * sem mídia: os dois casos fariam `media` e `attachments` contarem histórias diferentes.
 */
function attachmentsOf(
  type: MessageType,
  media: Media | undefined,
  source: MediaSource | undefined,
  sources: readonly MediaSource[] | undefined,
): readonly Media[] {
  if (media === undefined) {
    if (sources !== undefined && sources.length > 0) {
      throw new TypeError(`createMessage: mensagem "${type}" não tem mídia, mas veio com anexos`);
    }
    return NO_ATTACHMENTS;
  }
  if (sources === undefined) return [media];
  if (sources[0] !== source) {
    throw new TypeError('createMessage: `attachments` deve começar pela própria `media`');
  }
  return [media, ...sources.slice(1).map(createMedia)];
}
