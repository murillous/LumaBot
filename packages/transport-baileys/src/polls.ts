// Votos de enquete (#312, ADR 0071). O WhatsApp cifra o voto com o segredo da enquete
// (`messageSecret`), que só vem na mensagem que a criou, e o Baileys 7 não decifra mais sozinho (o
// trecho do `process-message` está comentado). Por isso o transport guarda as enquetes que vê e
// decifra o voto com `decryptPollVote`.

import { createHash } from 'node:crypto';
import type { TransportEvents } from '@zapforge/core/adapter';
import {
  decryptPollVote,
  jidNormalizedUser,
  type proto,
  type WAMessage,
  type WAMessageKey,
} from 'baileys';
import { type ContactBook, chatOf } from './events.ts';
import { authorOf, type NormalizeEnv, unwrap } from './normalize.ts';

type Env = Pick<NormalizeEnv, 'selfIds' | 'pnForLid'>;

interface KnownPoll {
  readonly key: WAMessageKey;
  readonly secret: Uint8Array;
  /** SHA-256 de cada opção, em hex, na ordem da enquete: o voto traz os hashes, não o texto. */
  readonly hashes: readonly string[];
}

/** Enquetes guardadas por padrão; a mais antiga sai primeiro. */
const DEFAULT_MAX_POLLS = 1000;

/**
 * Enquetes que a sessão enviou ou recebeu enquanto conectada, pelo ID da mensagem. O ID basta: o
 * mesmo chat privado aparece ora como LID, ora como telefone, e o ID do WhatsApp é aleatório. Vive
 * até o `disconnect()`: voto de enquete anterior não se decifra e é descartado.
 */
export class PollBook {
  readonly #polls = new Map<string, KnownPoll>();
  readonly #max: number;

  constructor(max: number = DEFAULT_MAX_POLLS) {
    this.#max = max;
  }

  /** Guarda a enquete, se a mensagem for uma e trouxer o segredo; o resto é ignorado. */
  remember(raw: WAMessage): void {
    const id = raw.key.id;
    if (!id || !raw.message) return;
    const { content } = unwrap(raw.message);
    const poll =
      content.pollCreationMessage ??
      content.pollCreationMessageV2 ??
      content.pollCreationMessageV3 ??
      content.pollCreationMessageV5;
    // A V4 é envelope: o segredo pode vir fora ou dentro dele.
    const secret =
      raw.message.messageContextInfo?.messageSecret ?? content.messageContextInfo?.messageSecret;
    if (!poll || !secret) return;
    this.#polls.delete(id);
    this.#polls.set(id, {
      key: raw.key,
      secret,
      hashes: (poll.options ?? []).map((o) => sha256Hex(o.optionName ?? '')),
    });
    if (this.#polls.size > this.#max) {
      const oldest = this.#polls.keys().next().value;
      if (oldest !== undefined) this.#polls.delete(oldest);
    }
  }

  get(id: string): KnownPoll | undefined {
    return this.#polls.get(id);
  }

  clear(): void {
    this.#polls.clear();
  }
}

/** O `pollUpdateMessage` da mensagem, se ela for um voto. */
export function pollUpdateOf(raw: WAMessage): proto.Message.IPollUpdateMessage | null {
  return raw.message ? (unwrap(raw.message).content.pollUpdateMessage ?? null) : null;
}

/**
 * `poll.vote` a partir do `pollUpdateMessage`. Devolve `null` quando a enquete não está no
 * `PollBook` (enviada antes da conexão atual, por exemplo) e lança quando ela está, mas o voto não
 * decifra.
 */
export async function toPollVote(
  raw: WAMessage,
  polls: PollBook,
  env: Env,
  contacts: ContactBook,
): Promise<TransportEvents['poll.vote'] | null> {
  const update = pollUpdateOf(raw);
  const pollKey = update?.pollCreationMessageKey;
  const chatId = raw.key.remoteJid;
  if (!update?.vote || !pollKey?.id || !chatId) return null;
  const poll = polls.get(pollKey.id);
  if (poll === undefined) return null;
  const vote = decrypt(update.vote, poll, pollKey, raw.key, env.selfIds);
  if (vote === null) throw new Error('baileys: o voto da enquete não decifrou');
  const options = new Set<number>();
  for (const hash of vote.selectedOptions ?? []) {
    const index = poll.hashes.indexOf(Buffer.from(hash).toString('hex'));
    // Hash fora da lista: opção que esta enquete não tem. Fica de fora em vez de virar índice.
    if (index >= 0) options.add(index);
  }
  return {
    chat: chatOf(chatId),
    messageId: pollKey.id,
    sender: contacts.named(await authorOf(raw.key, chatId, env, raw.pushName ?? null)),
    options: [...options].sort((a, b) => a - b),
    fromMe: raw.key.fromMe === true,
  };
}

/**
 * Decifra o voto. A chave sai do JID de quem criou e de quem votou, como o aparelho do votante os
 * viu, e com o LID ele pode ter usado o telefone ou o LID: tenta cada par conhecido.
 */
function decrypt(
  vote: proto.Message.IPollEncValue,
  poll: KnownPoll,
  pollKey: proto.IMessageKey,
  voteKey: WAMessageKey,
  selfIds: readonly string[],
): proto.Message.PollVoteMessage | null {
  const creators = unique([...jidsOf(poll.key, selfIds), ...jidsOf(pollKey, selfIds)]);
  const voters = unique(jidsOf(voteKey, selfIds));
  const pollMsgId = pollKey.id ?? '';
  for (const pollCreatorJid of creators) {
    for (const voterJid of voters) {
      const decrypted = tryDecrypt(vote, {
        pollCreatorJid,
        pollMsgId,
        pollEncKey: poll.secret,
        voterJid,
      });
      if (decrypted !== null) return decrypted;
    }
  }
  return null;
}

function tryDecrypt(
  vote: proto.Message.IPollEncValue,
  context: Parameters<typeof decryptPollVote>[1],
): proto.Message.PollVoteMessage | null {
  try {
    return decryptPollVote(vote, context);
  } catch {
    // Par de JIDs errado: a autenticação do AES-GCM falha, e o próximo par é tentado.
    return null;
  }
}

/** JIDs possíveis do autor de uma chave: o da sessão, o do participante ou o do chat privado. */
function jidsOf(
  key: proto.IMessageKey & { participantAlt?: string; remoteJidAlt?: string },
  selfIds: readonly string[],
): string[] {
  if (key.fromMe) return [...selfIds];
  const jids = key.participant
    ? [key.participant, key.participantAlt]
    : [key.remoteJid, key.remoteJidAlt];
  return jids.flatMap((jid) => (jid ? [jidNormalizedUser(jid) || jid] : []));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
