// Testes de tipo do `Chat` multiplataforma (ADR 0058); verificados pelo `pnpm typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import type { Chat, ChatKind } from '#message/types.ts';

describe('Chat multiplataforma (ADR 0058)', () => {
  it('kind, parentId e title são opcionais: id e isGroup seguem bastando', () => {
    const chat: Chat = { id: 'c', isGroup: false };
    expectTypeOf(chat.kind).toEqualTypeOf<ChatKind | undefined>();
    expectTypeOf(chat.parentId).toEqualTypeOf<string | undefined>();
    expectTypeOf(chat.title).toEqualTypeOf<string | undefined>();
  });

  it('kind só aceita os quatro tipos', () => {
    expectTypeOf<ChatKind>().toEqualTypeOf<'dm' | 'group' | 'channel' | 'thread'>();
    // @ts-expect-error tipo de chat desconhecido
    const chat: Chat = { id: 'c', isGroup: true, kind: 'forum' };
    void chat;
  });
});
