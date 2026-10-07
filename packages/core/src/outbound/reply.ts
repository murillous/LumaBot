import type { Message } from '#message/types.ts';
import type { MessageKey, OutgoingContent } from '#transport/types.ts';
import type { OutboundSendOptions, Reply, ReplyOptions, Sender } from './types.ts';

export interface CreateReplyOptions {
  /**
   * Cita a mensagem original. Padrão: `true`. Quem monta o contexto passa `false` quando o
   * transport não tem a capability `quoted`, para a resposta não falhar com `UnsupportedError`.
   */
  readonly quote?: boolean;
}

/**
 * Monta o `ctx.reply` de uma mensagem: envia no chat dela, citando-a, com prioridade `high`,
 * pelo `sender` (a fila de saída). O plugin não vê a fila — só chama `reply`.
 */
export function createReply(
  sender: Sender,
  message: Message,
  options: CreateReplyOptions = {},
): Reply {
  const chatId = message.chat.id;
  const quoted = options.quote === false ? undefined : message;

  const send = (content: OutgoingContent, replyOptions: ReplyOptions = {}): Promise<MessageKey> => {
    const sendOptions: OutboundSendOptions = {
      priority: replyOptions.priority ?? 'high',
      ...(quoted && { quoted }),
      ...(replyOptions.mentions && { mentions: replyOptions.mentions }),
    };
    return sender.send(chatId, content, sendOptions);
  };

  const shortcuts: Pick<Reply, keyof Reply> = {
    text: (text: string, o?: ReplyOptions) => send({ type: 'text', text }, o),
    image: (media, o = {}) =>
      send({ type: 'image', media, ...pick(o, 'caption'), ...pick(o, 'mimetype') }, o),
    video: (media, o = {}) =>
      send({ type: 'video', media, ...pick(o, 'caption'), ...pick(o, 'mimetype') }, o),
    audio: (media, o = {}) => send({ type: 'audio', media, ...pick(o, 'mimetype') }, o),
    voice: (media, o = {}) => send({ type: 'voice', media, ...pick(o, 'mimetype') }, o),
    sticker: (media, o) => send({ type: 'sticker', media }, o),
    document: (media, o) =>
      send(
        {
          type: 'document',
          media,
          fileName: o.fileName,
          mimetype: o.mimetype,
          ...pick(o, 'caption'),
        },
        o,
      ),
    poll: (name, choices, o = {}) =>
      send({ type: 'poll', name, options: choices, ...pick(o, 'selectableCount') }, o),
  };
  return Object.assign(
    (text: string, o?: ReplyOptions) => send({ type: 'text', text }, o),
    shortcuts,
  );
}

/** `{ [key]: valor }` só quando definido, para não mandar `undefined` explícito ao transport. */
function pick<T extends object, K extends keyof T>(source: T, key: K): Partial<Pick<T, K>> {
  const value = source[key];
  return value === undefined ? {} : ({ [key]: value } as Partial<Pick<T, K>>);
}
