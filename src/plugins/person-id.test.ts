import { expect, it } from 'vitest';
import { personId } from './person-id.ts';

it('usa o JID de telefone quando o telefone é conhecido', () => {
  expect(personId({ id: '123@lid', phone: '5511999990001' })).toBe('5511999990001@s.whatsapp.net');
});

it('sem telefone, mantém o id cru', () => {
  expect(personId({ id: '123@lid', phone: null })).toBe('123@lid');
});
