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
  const message: TextMessage = {
    type: 'text',
    id: 'msg-1',
    chat: { id: init.chatId ?? 'chat-1', isGroup: false },
    sender: {
      id: init.senderId ?? 'user-1',
      name: init.senderName === undefined ? 'Fulano' : init.senderName,
    },
    text: init.text ?? 'oi',
    timestamp: 0,
    fromMe: init.fromMe ?? false,
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
