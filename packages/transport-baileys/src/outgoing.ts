// Envio (M2-1.3): o conteúdo, a chave e os metadados de grupo do core no formato do Baileys, e
// de volta. Funções puras; quem fala com o socket é o transport.

import type {
  GroupMetadata,
  GroupParticipant,
  Message,
  MessageKey,
  OutgoingContent,
  SendOptions,
} from '@zapforge/core';
import {
  type AnyMessageContent,
  type GroupMetadata as BaileysGroupMetadata,
  jidNormalizedUser,
  type WAMessage,
  type WAMessageKey,
} from 'baileys';
import { type NormalizeEnv, nativeOf, resolveContact } from './normalize.ts';

/** Conteúdo do `sendMessage`, com as menções que o Baileys põe no `contextInfo` de qualquer tipo. */
export function toContent(content: OutgoingContent, options?: SendOptions): AnyMessageContent {
  const mentions = options?.mentions?.length ? { mentions: [...options.mentions] } : {};
  switch (content.type) {
    case 'text':
      return { text: content.text, ...mentions };
    case 'image':
      return {
        image: content.media,
        caption: content.caption,
        mimetype: content.mimetype,
        ...mentions,
      };
    case 'video':
      return {
        video: content.media,
        caption: content.caption,
        mimetype: content.mimetype,
        ...mentions,
      };
    case 'audio':
    case 'voice':
      // Voz é áudio com `ptt`; sem `mimetype`, o Baileys usa `audio/ogg; codecs=opus`.
      return {
        audio: content.media,
        ptt: content.type === 'voice',
        mimetype: content.mimetype,
        ...mentions,
      };
    case 'sticker':
      return { sticker: content.media, ...mentions };
    case 'document':
      return {
        document: content.media,
        fileName: content.fileName,
        mimetype: content.mimetype,
        caption: content.caption,
        ...mentions,
      };
    case 'poll':
      return {
        poll: {
          name: content.name,
          values: [...content.options],
          selectableCount: content.selectableCount ?? 1,
        },
        ...mentions,
      };
  }
}

export function toWAKey(key: MessageKey): WAMessageKey {
  return {
    remoteJid: key.chatId,
    id: key.id,
    fromMe: key.fromMe,
    participant: key.senderId ?? undefined,
  };
}

/**
 * A mensagem a citar como o Baileys a quer. Recebida por este transport, vai o proto original
 * (a citada mostra mídia e legenda); montada fora dele (testes, storage), vai só o texto.
 */
export function toQuoted(message: Message): WAMessage {
  return (
    nativeOf(message) ?? {
      key: toWAKey(message.key),
      message: { conversation: message.text ?? '' },
    }
  );
}

/** Metadados do grupo com o telefone de cada participante resolvido, inclusive com LID. */
export async function toGroupMetadata(
  native: BaileysGroupMetadata,
  env: Pick<NormalizeEnv, 'pnForLid'>,
): Promise<GroupMetadata> {
  const participants = await Promise.all(
    native.participants.map(async (p): Promise<GroupParticipant> => {
      const contact = await resolveContact(env, p.id, p.phoneNumber, p.name ?? p.notify ?? null);
      return {
        ...contact,
        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        isSuperAdmin: p.admin === 'superadmin',
      };
    }),
  );
  return {
    id: native.id,
    title: native.subject,
    description: native.desc ?? null,
    ownerId: native.owner ? jidNormalizedUser(native.owner) || native.owner : null,
    participants,
  };
}
