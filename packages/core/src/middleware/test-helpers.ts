import type { MessageContext } from '#context.ts';
import type { Message, MessageType, TextMessage } from '#message/types.ts';

export interface FakeMessageInit {
  readonly text?: string;
  readonly chatId?: string;
  readonly senderId?: string;
  readonly senderName?: string | null;
  readonly fromMe?: boolean;
}

/** Contexto mínimo com uma `TextMessage` para os testes dos middlewares. */
export function fakeContext(init: FakeMessageInit = {}): MessageContext {
  const chatId = init.chatId ?? 'chat-1';
  const fromMe = init.fromMe ?? false;
  const message: TextMessage = {
    type: 'text',
    id: 'msg-1',
    key: { chatId, id: 'msg-1', fromMe, senderId: null },
    chat: { id: chatId, isGroup: false },
    sender: {
      id: init.senderId ?? 'user-1',
      name: init.senderName === undefined ? 'Fulano' : init.senderName,
      phone: null,
    },
    text: init.text ?? 'oi',
    timestamp: 0,
    fromMe,
    quoted: null,
    mentions: [],
    isForwarded: false,
    isViewOnce: false,
    isEdited: false,
    is<K extends MessageType>(type: K): this is Extract<Message, { readonly type: K }> {
      return (type as MessageType) === 'text';
    },
  };
  return { message };
}
