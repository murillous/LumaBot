// Mapeamento de eventos (M2-1.6): o que o Baileys emite além das mensagens novas → eventos do
// barramento (plano §6.4). Reação, edição e apagamento chegam ao Baileys como mensagens de
// controle, que ele já converte em `messages.reaction` e `messages.update`; grupos chegam em
// `groups.upsert`, `groups.update` e `group-participants.update`.

import type { Chat, Contact, Message } from '@zapforge/core';
import type { TransportEvents } from '@zapforge/core/adapter';
import {
  type BaileysEventMap,
  type GroupMetadata as BaileysGroupMetadata,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
  type WAMessageUpdate,
} from 'baileys';
import {
  authorJid,
  authorOf,
  type NormalizeEnv,
  resolveContact,
  toEditedMessage,
} from './normalize.ts';

type Env = Pick<NormalizeEnv, 'selfIds' | 'pnForLid'>;

/**
 * Nome e telefone já vistos de cada contato. Decide quando sai o `contact.updated` e dá nome a
 * quem aparece sem `pushName` (reação, edição, apagamento, grupo). Vive enquanto o transport
 * vive: depois de reiniciar o processo, cada contato conta de novo como visto pela primeira vez.
 */
export class ContactBook {
  readonly #known = new Map<
    string,
    { readonly name: string | null; readonly phone: string | null }
  >();

  /**
   * Registra um remetente. Devolve o `contact.updated` quando há o que contar: na primeira vez
   * que o contato aparece (ADR 0049) ou quando o nome ou o telefone mudou. Campo desconhecido
   * (`null`) não apaga o que já se sabia.
   */
  observe(contact: Contact): TransportEvents['contact.updated'] | null {
    const known = this.#known.get(contact.id);
    const name = contact.name ?? known?.name ?? null;
    const phone = contact.phone ?? known?.phone ?? null;
    this.#known.set(contact.id, { name, phone });
    const update: { id: string; name?: string; phone?: string } = { id: contact.id };
    if (name !== null && name !== known?.name) update.name = name;
    if (phone !== null && phone !== known?.phone) update.phone = phone;
    return update.name === undefined && update.phone === undefined ? null : update;
  }

  nameOf(id: string): string | null {
    return this.#known.get(id)?.name ?? null;
  }

  /** O contato com o nome já visto, quando o evento não trouxe nenhum. */
  named(contact: Contact): Contact {
    return contact.name === null ? { ...contact, name: this.nameOf(contact.id) } : contact;
  }
}

function chatOf(id: string): Chat {
  return { id, isGroup: isJidGroup(id) === true };
}

/**
 * `reaction` a partir do `messages.reaction`: `key` é a mensagem reagida e `reaction.key` a
 * mensagem de reação, que diz quem reagiu. Texto vazio é reação removida.
 */
export async function toReaction(
  { key, reaction }: BaileysEventMap['messages.reaction'][number],
  env: Env,
  contacts: ContactBook,
): Promise<TransportEvents['reaction'] | null> {
  const from = reaction.key;
  const chatId = from?.remoteJid ?? key.remoteJid;
  if (!from || !chatId || !key.id || isJidStatusBroadcast(chatId)) return null;
  return {
    chat: chatOf(chatId),
    messageId: key.id,
    sender: contacts.named(await authorOf(from, chatId, env, null)),
    emoji: reaction.text || null,
    fromMe: from.fromMe === true,
  };
}

/**
 * `message.edited` a partir do `messages.update` de edição. A chave é a da original com o autor
 * da edição, e o conteúdo novo vem em `editedMessage`.
 */
export function toEdited(
  { key, update }: WAMessageUpdate,
  env: NormalizeEnv,
  contacts: ContactBook,
): Promise<Message | null> {
  const content = update.message?.editedMessage?.message;
  const chatId = key.remoteJid;
  if (!content || !chatId || isJidStatusBroadcast(chatId)) return Promise.resolve(null);
  return toEditedMessage(
    {
      key,
      message: content,
      // Sem o horário da edição, vale o da chegada.
      messageTimestamp: update.messageTimestamp ?? Math.floor(Date.now() / 1000),
      pushName: contacts.nameOf(jidNormalizedUser(authorJid(key, chatId, env.selfIds))),
    },
    env,
  );
}

/**
 * `message.deleted` a partir do `messages.update` de apagamento (`REVOKE`). `key` é a apagada;
 * `update.key` é a mensagem que apagou, que diz quem apagou (o autor ou um admin do grupo).
 */
export async function toDeleted(
  { key, update }: WAMessageUpdate,
  env: Env,
  contacts: ContactBook,
): Promise<TransportEvents['message.deleted'] | null> {
  const chatId = key.remoteJid;
  if (!chatId || !key.id || isJidStatusBroadcast(chatId)) return null;
  const by = update.key;
  return {
    chat: chatOf(chatId),
    messageId: key.id,
    deletedBy: by ? contacts.named(await authorOf(by, chatId, env, null)) : null,
    fromMe: (by ?? key).fromMe === true,
  };
}

type ParticipantsUpdate = BaileysEventMap['group-participants.update'];
type Participant = ParticipantsUpdate['participants'][number];

/** O que um `group-participants.update` vira no barramento. */
export interface ParticipantEvents {
  /** A própria sessão entrou ou saiu do grupo. */
  readonly self: 'group.joined' | 'group.left' | null;
  /** Os demais participantes; `null` se não sobrou nenhum. */
  readonly others: TransportEvents['group.participants'] | null;
}

/**
 * Converte a alteração de participantes. Entrada e saída da própria sessão viram
 * `group.joined`/`group.left` e saem da lista; promovida ou rebaixada, ela segue em
 * `group.participants`. Troca de número (`modify`) não tem evento no core.
 */
export async function toParticipantEvents(
  { id, author, authorPn, participants, action }: ParticipantsUpdate,
  env: Env,
  contacts: ContactBook,
): Promise<ParticipantEvents> {
  if (action === 'modify') return { self: null, others: null };
  const isSelf = (p: Participant): boolean =>
    [p.id, p.phoneNumber, p.lid].some((jid) => jid && env.selfIds.includes(jidNormalizedUser(jid)));
  const selfIn = participants.some(isSelf);
  const self = !selfIn
    ? null
    : action === 'add'
      ? 'group.joined'
      : action === 'remove'
        ? 'group.left'
        : null;
  const rest = self === null ? participants : participants.filter((p) => !isSelf(p));
  if (rest.length === 0) return { self, others: null };
  const contact = async (jid: string, alt: string | undefined, name: string | null) =>
    contacts.named(await resolveContact(env, jid, alt, name));
  return {
    self,
    others: {
      groupId: id,
      action,
      participants: await Promise.all(
        rest.map((p) => contact(p.id, p.phoneNumber, p.notify ?? p.name ?? null)),
      ),
      actor: author ? await contact(author, authorPn, null) : null,
    },
  };
}

/**
 * `group.updated` com só os campos que mudaram. O Baileys também emite `groups.update` com os
 * metadados completos de cada grupo ao sincronizar (`groupFetchAllParticipating`); esse traz
 * `participants` e não é uma alteração, então fica de fora.
 */
export function toGroupUpdated(
  update: Partial<BaileysGroupMetadata>,
): TransportEvents['group.updated'] | null {
  if (!update.id || update.participants) return null;
  const changed: {
    groupId: string;
    subject?: string;
    description?: string | null;
    announce?: boolean;
    restrict?: boolean;
  } = { groupId: update.id };
  if (update.subject !== undefined) changed.subject = update.subject;
  // Descrição removida chega com `desc` presente e vazio.
  if ('desc' in update) changed.description = update.desc || null;
  if (update.announce !== undefined) changed.announce = update.announce;
  if (update.restrict !== undefined) changed.restrict = update.restrict;
  return Object.keys(changed).length > 1 ? changed : null;
}
