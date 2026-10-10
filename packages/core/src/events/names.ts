import type { BotEventName } from './types.ts';

// Objeto mapeado em vez de array: o compilador barra evento faltando e evento a mais, então a
// lista de runtime não descola de `BotEvents`.
const names: { readonly [E in BotEventName]: true } = {
  message: true,
  'message.edited': true,
  'message.deleted': true,
  reaction: true,
  'poll.vote': true,
  'group.joined': true,
  'group.left': true,
  'group.participants': true,
  'group.updated': true,
  'contact.updated': true,
  'connection.status': true,
  'connection.qr': true,
  'connection.pairing-code': true,
  'message:text': true,
  'message:image': true,
  'message:video': true,
  'message:audio': true,
  'message:voice': true,
  'message:sticker': true,
  'message:document': true,
  'message:location': true,
  'message:contact': true,
  'message:poll': true,
  'message:unknown': true,
  command: true,
  'plugin.error': true,
};

/**
 * Valida nomes de evento vindos de fora do sistema de tipos (o `on` de um manifesto em JS): um
 * nome com erro de digitação nunca dispararia, sem aviso nenhum.
 */
export function isBotEventName(value: string): value is BotEventName {
  return Object.hasOwn(names, value);
}
