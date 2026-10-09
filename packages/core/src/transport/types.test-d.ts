// Testes de tipo do contrato de capabilities (ADR 0070), verificados pelo `pnpm typecheck` (ver
// message/types.test-d.ts).
import { describe, expectTypeOf, it } from 'vitest';
import type { Outbound, ReplyPollOptions } from '#outbound/types.ts';
import type { Capability } from './capabilities.ts';
import type { OutgoingContent, Transport, TypingKind } from './types.ts';

type PollContent = Extract<OutgoingContent, { type: 'poll' }>;
declare const send: Outbound;

describe('typing', () => {
  it('só "digitando" e "gravando": sem status online nem pausa', () => {
    expectTypeOf<TypingKind>().toEqualTypeOf<'text' | 'voice'>();
    expectTypeOf<Parameters<Transport['sendTyping']>>().toEqualTypeOf<[string, TypingKind]>();
  });

  it('a capability é typing, e presence deixou de existir', () => {
    expectTypeOf<'typing'>().toExtend<Capability>();
    expectTypeOf<'presence'>().not.toExtend<Capability>();
  });

  it('ctx.send.typing recusa os estados de presença do WhatsApp', () => {
    // @ts-expect-error `composing` é do Baileys; o contrato fala `text`
    send.typing('c', 'composing');
    // @ts-expect-error status online global não é do contrato
    send.typing('c', 'available');
  });
});

describe('polls', () => {
  it('multiple é booleano, sem contagem', () => {
    expectTypeOf<PollContent['multiple']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ReplyPollOptions['multiple']>().toEqualTypeOf<boolean | undefined>();
    // @ts-expect-error o Telegram e o Discord não limitam quantas opções
    const poll: PollContent = { type: 'poll', name: 'n', options: ['a'], selectableCount: 2 };
    expectTypeOf(poll).toBeObject();
  });
});
