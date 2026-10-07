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
  ? Omit<M, 'is' | 'key' | 'media' | DefaultedKey> &
      Partial<Pick<M, DefaultedKey>> &
      (M extends { readonly media: Media } ? { readonly media: MediaSource } : unknown)
  : never;

/**
 * Dados que o transport passa a `createMessage`. Mídia entra como `MediaSource` (o loader
 * nativo); `quoted` entra já normalizado, construído com `createMessage` também. `key` não entra:
 * é derivada dos outros campos.
 */
export type MessageInit = InitOf<Message>;

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
    ...(source === undefined ? null : { media: createMedia(source) }),
    is,
  };
  return message as unknown as MessageOf<I['type']>;
}
