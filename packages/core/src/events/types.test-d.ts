// Testes de tipo do barramento (aceite do M1-7: todos os eventos do §6.4 tipados). Quem os
// verifica é o `pnpm typecheck`, como em src/message/types.test-d.ts.
import { describe, expectTypeOf, it } from 'vitest';
import type { EmittableEventName, EventBus } from '#events/bus.ts';
import type {
  BotEventName,
  BotEvents,
  EventSubscriber,
  ListenerContext,
  PluginErrorEvent,
} from '#events/types.ts';
import type { ImageMessage, Message, MessageType, VoiceMessage } from '#message/types.ts';
import type { ConnectionStatus } from '#transport/types.ts';

const noop = (): void => undefined;
declare const events: EventSubscriber;
declare const bus: EventBus;

describe('eventos do §6.4', () => {
  it('BotEvents tem todos os nomes do plano', () => {
    type Planned =
      | 'message'
      | `message:${MessageType}`
      | 'message.edited'
      | 'message.deleted'
      | 'reaction'
      | 'group.joined'
      | 'group.left'
      | 'group.participants'
      | 'group.updated'
      | 'connection.status'
      | 'connection.qr'
      | 'plugin.error';
    expectTypeOf<BotEventName>().toEqualTypeOf<Planned>();
  });

  it('payloads tipados por evento', () => {
    expectTypeOf<BotEvents['message']>().toEqualTypeOf<Message>();
    expectTypeOf<BotEvents['message:image']>().toEqualTypeOf<ImageMessage>();
    expectTypeOf<BotEvents['message:voice']>().toEqualTypeOf<VoiceMessage>();
    expectTypeOf<BotEvents['message.edited']>().toEqualTypeOf<Message>();
    expectTypeOf<BotEvents['connection.status']>().toEqualTypeOf<ConnectionStatus>();
    expectTypeOf<BotEvents['plugin.error']>().toEqualTypeOf<PluginErrorEvent>();
    expectTypeOf<BotEvents['connection.qr']>().toEqualTypeOf<{ readonly qr: string }>();
  });
});

describe('on()', () => {
  it('o listener recebe o contexto do evento assinado', () => {
    events.on('message:image', (ctx) => {
      expectTypeOf(ctx).toEqualTypeOf<ListenerContext<'message:image'>>();
      expectTypeOf(ctx.payload).toEqualTypeOf<ImageMessage>();
      expectTypeOf(ctx.claimed).toEqualTypeOf<boolean>();
    });
    events.on('group.joined', (ctx) => {
      expectTypeOf(ctx.payload.groupId).toEqualTypeOf<string>();
    });
  });

  it('opções no fim ou no meio, e filtro de mensagem só em eventos de mensagem', () => {
    events.on('message', { quoted: 'audio', priority: -10 }, (ctx) => {
      expectTypeOf(ctx.payload).toEqualTypeOf<Message>();
    });
    events.on('message:text', noop, { quoted: ['image', 'video'], timeoutMs: 100 });
    events.on('message.edited', { quoted: 'image' }, noop);
    events.on('reaction', { priority: 1 }, noop);
    // @ts-expect-error `quoted` não existe fora dos eventos de mensagem
    events.on('reaction', { quoted: 'image' }, noop);
    // @ts-expect-error tipo de mensagem inexistente
    events.on('message', { quoted: 'gif' }, noop);
  });
});

describe('emit()', () => {
  it('message:<type> não se emite diretamente: o bus o deriva de message', () => {
    expectTypeOf<EmittableEventName>().not.toEqualTypeOf<BotEventName>();
    expectTypeOf<'message:image'>().not.toExtend<EmittableEventName>();
    expectTypeOf<'message'>().toExtend<EmittableEventName>();
    // @ts-expect-error emitir message:image direto pularia os listeners de message
    void bus.emit('message:image', {} as ImageMessage);
    // @ts-expect-error payload do evento errado
    void bus.emit('group.left', { qr: 'x' });
  });
});
