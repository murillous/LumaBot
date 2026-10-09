// Testes de tipo do `Contact.phone` (M1-16.4); verificados pelo `pnpm typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import { createMessage } from '#message/create.ts';
import type { Contact } from '#message/types.ts';
import type { JsonValue } from '#storage/types.ts';

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

describe('Contact multiplataforma (ADR 0057)', () => {
  it('username, isBot e claims são opcionais: id, name e phone seguem bastando', () => {
    const contact: Contact = { id: 's', name: null, phone: null };
    expectTypeOf(contact.username).toEqualTypeOf<string | undefined>();
    expectTypeOf(contact.isBot).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(contact.claims).toEqualTypeOf<Readonly<Record<string, JsonValue>> | undefined>();
  });

  it('claims são só leitura para o plugin', () => {
    const contact: Contact = { id: 's', name: null, phone: null, claims: { papel: 'aluno' } };
    if (contact.claims === undefined) return;
    // @ts-expect-error claims são somente leitura
    contact.claims.papel = 'diretor';
  });
});
