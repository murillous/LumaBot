// `ctx.send` (ADR 0040): o envio e as ações sobre mensagens e chats, todos pela fila de saída. A
// fila não conhece as ações; aqui cada uma confere a capability e vira uma chamada enfileirada.

import { plainText } from '#text/format.ts';
import { assertCapability, type Capability } from '#transport/capabilities.ts';
import type { Transport } from '#transport/types.ts';
import type { OutboundQueue } from './queue.ts';
import { TextLimiter } from './text.ts';
import type { ActionOptions, Outbound } from './types.ts';

/** O que as ações usam do transport. */
export type ActionTransport = Pick<
  Transport,
  'name' | 'capabilities' | 'react' | 'edit' | 'delete' | 'sendPresence' | 'limits'
>;

/** Enfileira `run` no chat se o transport tem a capability; sem ela, rejeita já. */
export type EnqueueAction = (
  capability: Capability,
  chatId: string,
  run: () => Promise<void>,
  options?: ActionOptions,
) => Promise<void>;

export function enqueueAction(
  queue: Pick<OutboundQueue, 'enqueue'>,
  transport: Pick<Transport, 'name' | 'capabilities'>,
): EnqueueAction {
  return (capability, chatId, run, options) => {
    try {
      // Capability ausente nunca vira tentativa, como no envio.
      assertCapability(transport, capability);
    } catch (error) {
      return Promise.reject(error);
    }
    return queue.enqueue(chatId, run, options);
  };
}

export function createOutbound(
  queue: Pick<OutboundQueue, 'send' | 'enqueue'>,
  transport: ActionTransport,
): Outbound {
  const action = enqueueAction(queue, transport);
  const limiter = new TextLimiter(transport);
  return {
    send: (chatId, content, options) => queue.send(chatId, content, options),
    react: (key, emoji, options) =>
      action('reactions', key.chatId, () => transport.react(key, emoji), options),
    edit: (key, text, options) => {
      try {
        limiter.assertEditFits(text);
      } catch (error) {
        return Promise.reject(error);
      }
      // A árvore vai junto do texto visível, como no envio (ADR 0061).
      if (typeof text === 'string') {
        return action('message.edit', key.chatId, () => transport.edit(key, text), options);
      }
      const visible = plainText(text);
      return action('message.edit', key.chatId, () => transport.edit(key, visible, text), options);
    },
    delete: (key, options) =>
      action('message.delete', key.chatId, () => transport.delete(key), options),
    presence: (chatId, presence, options) =>
      action('presence', chatId, () => transport.sendPresence(chatId, presence), options),
  };
}
