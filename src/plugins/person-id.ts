import type { Contact } from '@usebridger/core';

/**
 * Id estável da pessoa: o JID de telefone quando o transport sabe o telefone, senão o `id` cru.
 * No WhatsApp a mesma pessoa chega como LID num chat e como número em outro; o telefone é o que
 * os dois têm em comum. Em JID (e não só dígitos) para o `userNames.displayName` continuar
 * resolvendo a chave, já que ele guarda o que viu em privado sob o JID de telefone.
 */
export const personId = (c: Pick<Contact, 'id' | 'phone'>): string =>
  c.phone ? `${c.phone}@s.whatsapp.net` : c.id;
