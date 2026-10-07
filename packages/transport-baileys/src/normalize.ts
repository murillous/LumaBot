// Normalização (M2-1.2): `WAMessage` do Baileys → `Message` do core (ADR 0009). Desembrulha os
// envelopes (ephemeral, viewOnce, documentWithCaption), resolve o telefone de cada contato,
// inclusive com LID (M1-16.4, ADR 0046), e monta a citada como `Message` também.

import type { Contact, Message } from '@zapforge/core';
import { createMessage, type MediaSource, type MessageInit } from '@zapforge/core/adapter';
import {
  isJidGroup,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  type proto,
  toNumber,
  type WAMessage,
} from 'baileys';

/** O que a normalização precisa da sessão; o transport liga ao socket, os testes a falsos. */
export interface NormalizeEnv {
  /**
   * Ids da própria sessão sem aparelho, o JID de telefone primeiro e depois o LID. Dão o autor
   * das mensagens da sessão na conversa privada e o `fromMe` da citada.
   */
  readonly selfIds: readonly string[];
  /** JID de telefone de um LID, ou `null` se a sessão ainda não conhece o par. */
  pnForLid(lid: string): Promise<string | null>;
  download(raw: WAMessage): Promise<Buffer>;
  stream(raw: WAMessage): Promise<ReadableStream<Uint8Array>>;
}

type Content = proto.IMessage;

/** Envelopes que só embrulham o conteúdo de verdade. */
const ENVELOPES = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  // Ao contrário das outras versões, a V4 da enquete é um envelope com a enquete dentro.
  'pollCreationMessageV4',
] as const satisfies readonly (keyof Content)[];

const VIEW_ONCE: ReadonlySet<string> = new Set([
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
]);

/**
 * Campos que não são o conteúdo da mensagem. Edição, apagamento e reação viram eventos próprios
 * no mapeamento de eventos (M2-1.6); o resto é metadado do protocolo.
 */
const CONTROL: ReadonlySet<string> = new Set([
  'protocolMessage',
  'reactionMessage',
  'encReactionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'pinInChatMessage',
  'senderKeyDistributionMessage',
  'fastRatchetKeySenderKeyDistributionMessage',
  'messageContextInfo',
]);

/**
 * Tira os envelopes, em qualquer ordem e aninhados (ephemeral com viewOnce dentro, por exemplo).
 * O limite só protege de um proto malformado.
 */
export function unwrap(content: Content): { content: Content; viewOnce: boolean } {
  let current = content;
  let viewOnce = false;
  for (let depth = 0; depth < 10; depth++) {
    const envelope = ENVELOPES.find((name) => current[name]?.message);
    if (envelope === undefined) break;
    if (VIEW_ONCE.has(envelope)) viewOnce = true;
    current = current[envelope]?.message ?? current;
  }
  return { content: current, viewOnce };
}

/** Campo que define o tipo: o primeiro preenchido que não é de controle. */
function contentKey(content: Content): keyof Content | undefined {
  return (Object.keys(content) as (keyof Content)[]).find(
    (key) => content[key] != null && !CONTROL.has(key),
  );
}

/**
 * Converte uma mensagem do Baileys. `null` quando não há o que entregar: sem conteúdo (aviso de
 * grupo, mensagem que não deu para decifrar) ou só controle (edição, reação, apagamento).
 */
export function toMessage(raw: WAMessage, env: NormalizeEnv): Promise<Message | null> {
  return build(raw, env, toNumber(raw.messageTimestamp) * 1000);
}

async function build(
  raw: WAMessage,
  env: NormalizeEnv,
  timestamp: number,
): Promise<Message | null> {
  const chatId = raw.key.remoteJid;
  const id = raw.key.id;
  if (!raw.message || !chatId || !id) return null;

  const { content, viewOnce } = unwrap(raw.message);
  const key = contentKey(content);
  if (key === undefined) return null;

  const isGroup = isJidGroup(chatId) === true;
  const fromMe = raw.key.fromMe === true;
  const node = content[key];
  const context = contextOf(node);
  // Grupo, status e citada trazem o autor em `participant`. Sem ele (conversa privada), o
  // autor é o próprio chat, ou a sessão quando foi ela que mandou.
  const [author, alt] = raw.key.participant
    ? [raw.key.participant, raw.key.participantAlt]
    : fromMe
      ? [env.selfIds[0] ?? chatId, undefined]
      : [chatId, raw.key.remoteJidAlt];

  const base: Base = {
    id,
    chat: { id: chatId, isGroup },
    sender: await resolveContact(env, author, alt, raw.pushName ?? null),
    timestamp,
    fromMe,
    quoted: context ? await quoted(context, chatId, env, timestamp) : null,
    mentions: await Promise.all(
      (context?.mentionedJid ?? []).map((jid) => resolveContact(env, jid, undefined, null)),
    ),
    isForwarded: context?.isForwarded === true,
    isViewOnce: viewOnce || raw.key.isViewOnce === true || flag(node, 'viewOnce'),
  };
  // O download parte da mensagem sem envelopes: é o formato que o Baileys espera.
  const unwrapped: WAMessage = { ...raw, message: content };
  const media: MediaOf = (m) => ({
    mimetype: m.mimetype ?? 'application/octet-stream',
    size: m.fileLength == null ? null : toNumber(m.fileLength) || null,
    download: () => env.download(unwrapped),
    stream: () => env.stream(unwrapped),
  });

  const message = createMessage(init(key, content, base, media));
  natives.set(message, raw);
  return message;
}

/**
 * Mensagem do Baileys de onde cada `Message` saiu. Citar no envio precisa do proto original
 * (`quoted` do `sendMessage`); o `WeakMap` some com a `Message`, sem cache para limpar.
 */
const natives = new WeakMap<Message, WAMessage>();

/** O `WAMessage` que originou a mensagem, se ela foi normalizada por este transport. */
export function nativeOf(message: Message): WAMessage | undefined {
  return natives.get(message);
}

type Base = Omit<Extract<MessageInit, { type: 'unknown' }>, 'type' | 'text'>;
type MediaOf = (m: {
  readonly mimetype?: string | null;
  readonly fileLength?: Parameters<typeof toNumber>[0];
}) => MediaSource;

function init(key: keyof Content, c: Content, base: Base, media: MediaOf): MessageInit {
  switch (key) {
    case 'conversation':
      return { ...base, type: 'text', text: c.conversation ?? '' };
    case 'extendedTextMessage':
      return { ...base, type: 'text', text: c.extendedTextMessage?.text ?? '' };
    case 'imageMessage': {
      const m = c.imageMessage ?? {};
      return { ...base, type: 'image', text: m.caption ?? null, media: media(m) };
    }
    case 'videoMessage':
    case 'ptvMessage': {
      // `ptv` é o vídeo redondo (recado de vídeo): para o plugin, um vídeo.
      const m = c[key] ?? {};
      return { ...base, type: 'video', text: m.caption ?? null, media: media(m) };
    }
    case 'audioMessage': {
      const m = c.audioMessage ?? {};
      return { ...base, type: m.ptt ? 'voice' : 'audio', text: null, media: media(m) };
    }
    case 'stickerMessage':
      return { ...base, type: 'sticker', text: null, media: media(c.stickerMessage ?? {}) };
    case 'documentMessage': {
      const m = c.documentMessage ?? {};
      return {
        ...base,
        type: 'document',
        text: m.caption ?? null,
        fileName: m.fileName ?? null,
        media: media(m),
      };
    }
    case 'locationMessage': {
      const m = c.locationMessage ?? {};
      return {
        ...base,
        type: 'location',
        text: m.comment ?? null,
        location: {
          latitude: m.degreesLatitude ?? 0,
          longitude: m.degreesLongitude ?? 0,
          name: m.name ?? m.address ?? null,
        },
      };
    }
    case 'liveLocationMessage': {
      const m = c.liveLocationMessage ?? {};
      return {
        ...base,
        type: 'location',
        text: m.caption ?? null,
        location: {
          latitude: m.degreesLatitude ?? 0,
          longitude: m.degreesLongitude ?? 0,
          name: null,
        },
      };
    }
    case 'contactMessage':
    case 'contactsArrayMessage': {
      const list =
        key === 'contactMessage'
          ? [c.contactMessage ?? {}]
          : (c.contactsArrayMessage?.contacts ?? []);
      return {
        ...base,
        type: 'contact',
        text: null,
        contacts: list.map((m) => ({ name: m.displayName ?? '', vcard: m.vcard ?? '' })),
      };
    }
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
    case 'pollCreationMessageV5': {
      const m = c[key] ?? {};
      return {
        ...base,
        type: 'poll',
        text: null,
        poll: { name: m.name ?? '', options: (m.options ?? []).map((o) => o.optionName ?? '') },
      };
    }
    default:
      return { ...base, type: 'unknown', text: null };
  }
}

function contextOf(node: unknown): proto.IContextInfo | null {
  if (typeof node !== 'object' || node === null || !('contextInfo' in node)) return null;
  return (node.contextInfo as proto.IContextInfo | null | undefined) ?? null;
}

function flag(node: unknown, name: string): boolean {
  return (
    typeof node === 'object' && node !== null && name in node && Reflect.get(node, name) === true
  );
}

/**
 * A citada vem só com id, autor e conteúdo: sem horário (vale o da mensagem que cita) e sem nome
 * do autor.
 */
function quoted(
  context: proto.IContextInfo,
  chatId: string,
  env: NormalizeEnv,
  timestamp: number,
): Promise<Message | null> {
  if (!context.quotedMessage || !context.stanzaId) return Promise.resolve(null);
  const author = context.participant ? jidNormalizedUser(context.participant) : undefined;
  return build(
    {
      key: {
        remoteJid: context.remoteJid ?? chatId,
        id: context.stanzaId,
        fromMe: author !== undefined && env.selfIds.includes(author),
        participant: author,
      },
      message: context.quotedMessage,
    },
    env,
    timestamp,
  );
}

/**
 * Contato com o telefone resolvido: do próprio JID de telefone, do JID alternativo que o
 * Baileys manda junto com um LID ou do mapeamento LID ↔ telefone da sessão.
 */
export async function resolveContact(
  env: Pick<NormalizeEnv, 'pnForLid'>,
  jid: string,
  alt: string | null | undefined,
  name: string | null,
): Promise<Contact> {
  // Sem o aparelho: `5511…:12@s.whatsapp.net` e `5511…@s.whatsapp.net` são o mesmo contato.
  const id = jidNormalizedUser(jid) || jid;
  return { id, name, phone: await phoneOf(env, id, alt) };
}

async function phoneOf(
  env: Pick<NormalizeEnv, 'pnForLid'>,
  id: string,
  alt: string | null | undefined,
): Promise<string | null> {
  if (isPnUser(id)) return jidDecode(id)?.user ?? null;
  if (alt && isPnUser(alt)) return jidDecode(alt)?.user ?? null;
  if (!isLidUser(id)) return null;
  const pn = await env.pnForLid(id);
  return pn ? (jidDecode(pn)?.user ?? null) : null;
}
