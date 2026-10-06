import type { Message } from '#message/types.ts';
import type { MessageKey } from './types.ts';

/** Chave para reagir, editar ou apagar uma mensagem recebida. */
export function messageKey(message: Message): MessageKey {
  return {
    chatId: message.chat.id,
    id: message.id,
    fromMe: message.fromMe,
    // Em conversa privada o autor é implícito no chat; só grupos precisam dele.
    senderId: message.chat.isGroup ? message.sender.id : null,
  };
}
