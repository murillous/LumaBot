import type { Contact } from '@usebridger/core';

/**
 * Chave estável de uma pessoa para o que conta por pessoa (`rank`, uso). No WhatsApp, a mesma
 * pessoa chega com o LID num chat e com o número em outro; o `sender.id` muda, o `phone` que o
 * transport resolve não. Sem telefone conhecido, fica o id nativo.
 */
export const personId = (contact: Pick<Contact, 'id' | 'phone'>): string =>
  contact.phone ? `${contact.phone}@s.whatsapp.net` : contact.id;
