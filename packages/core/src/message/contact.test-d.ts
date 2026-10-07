// Testes de tipo do `Contact.phone` (M1-16.4); verificados pelo `pnpm typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import { createMessage } from '#message/create.ts';
import type { Contact } from '#message/types.ts';

describe('Contact.phone', () => {
  it('é obrigatório: o transport informa null quando não sabe o telefone', () => {
    expectTypeOf<Contact['phone']>().toEqualTypeOf<string | null>();
    createMessage({
      id: '1',
      chat: { id: 'c', isGroup: false },
      // @ts-expect-error remetente sem `phone`
      sender: { id: 's', name: null },
      timestamp: 0,
      fromMe: false,
      type: 'text',
      text: 'oi',
    });
  });
});
