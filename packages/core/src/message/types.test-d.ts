// Testes de tipo (aceite do M1-3), na convenção *.test-d.ts do Vitest: não rodam no `pnpm test`
// (em runtime `expectTypeOf` não faz nada) e quem os verifica é o `pnpm typecheck` — o `tsc -b`
// inclui todo src/. Um narrowing quebrado falha lá.
import { describe, expectTypeOf, it } from 'vitest';
import { createMessage } from '#message/create.ts';
import type {
  AudioMessage,
  ImageMessage,
  Media,
  MediaMessageType,
  Message,
  MessageOf,
  TextMessage,
  VoiceMessage,
} from '#message/types.ts';

declare const msg: Message;

describe('narrowing do modelo de mensagem', () => {
  it('is() estreita para o membro da union e expõe media', () => {
    if (msg.is('image')) {
      expectTypeOf(msg).toEqualTypeOf<ImageMessage>();
      expectTypeOf(msg.media).toEqualTypeOf<Media>();
    }
    // @ts-expect-error sem narrowing, `media` não existe em Message
    msg.media;
  });

  it('type estreita como discriminante, e voice não é audio', () => {
    if (msg.type === 'voice') {
      expectTypeOf(msg).toEqualTypeOf<VoiceMessage>();
      expectTypeOf(msg).not.toEqualTypeOf<AudioMessage>();
    }
    expectTypeOf<MessageOf<'voice'>>().not.toEqualTypeOf<MessageOf<'audio'>>();
    if (msg.type === 'text') expectTypeOf(msg.text).toEqualTypeOf<string>();
    else expectTypeOf(msg.text).toEqualTypeOf<string | null>();
  });

  it('quoted é Message | null e também estreita', () => {
    expectTypeOf(msg.quoted).toEqualTypeOf<Message | null>();
    if (msg.quoted?.is('audio')) expectTypeOf(msg.quoted.media).toEqualTypeOf<Media>();
  });

  it('o endereço da localização é opcional (ADR 0069)', () => {
    if (msg.is('location')) {
      expectTypeOf(msg.location.address).toEqualTypeOf<string | undefined>();
    }
  });

  it('MessageOf e MediaMessageType', () => {
    expectTypeOf<MessageOf<'text'>>().toEqualTypeOf<TextMessage>();
    expectTypeOf<MessageOf<'image' | 'video'>>().toEqualTypeOf<ImageMessage | MessageOf<'video'>>();
    expectTypeOf<MediaMessageType>().toEqualTypeOf<
      'image' | 'video' | 'audio' | 'voice' | 'sticker' | 'document'
    >();
  });
});

describe('tipos de createMessage', () => {
  const base = {
    id: '1',
    chat: { id: 'c', isGroup: false },
    sender: { id: 's', name: null, phone: null },
    timestamp: 0,
    fromMe: false,
  } as const;

  it('retorna o membro da union pelo type informado', () => {
    expectTypeOf(createMessage({ ...base, type: 'text', text: 'oi' })).toEqualTypeOf<TextMessage>();
    const image = createMessage({
      ...base,
      type: 'image',
      text: null,
      media: { mimetype: 'image/png', download: async () => Buffer.alloc(0) },
    });
    expectTypeOf(image).toEqualTypeOf<ImageMessage>();
  });

  it('exige os campos específicos de cada tipo', () => {
    // @ts-expect-error mensagem de mídia sem `media`
    createMessage({ ...base, type: 'image', text: null });
    // @ts-expect-error text precisa ser string em mensagem de texto
    createMessage({ ...base, type: 'text', text: null });
    // @ts-expect-error location sem `location`
    createMessage({ ...base, type: 'location', text: null });
    createMessage({
      ...base,
      type: 'location',
      text: null,
      // @ts-expect-error o endereço é string, sem `null`
      location: { latitude: 0, longitude: 0, name: null, address: null },
    });
    // @ts-expect-error fromMe é obrigatório
    createMessage({
      id: '1',
      chat: base.chat,
      sender: base.sender,
      timestamp: 0,
      type: 'unknown',
      text: null,
    });
  });
});
