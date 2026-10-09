// Voto de enquete (#312, ADR 0071): o teste cifra o voto como o aparelho de quem vota, com o
// segredo da enquete, e confere que o transport o decifra e emite `poll.vote` com os índices.

import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { createMemoryStorage, type Logger } from '@zapforge/core';
import type { TransportDeps, TransportEvents } from '@zapforge/core/adapter';
import { proto, type WAMessage } from 'baileys';
import { describe, expect, it } from 'vitest';
import { ContactBook } from './events.ts';
import { FakeDriver } from './fake-socket.test-support.ts';
import { PollBook, toPollVote } from './polls.ts';
import { BaileysTransport } from './transport.ts';

const GROUP = '120363000000000000@g.us';
const SELF = '5511999990000@s.whatsapp.net';
const SELF_LID = '999990000@lid';
const ALICE = '5511911110000@s.whatsapp.net';
const ALICE_LID = '911110000@lid';
const SECRET = new Uint8Array(32).fill(3);
const OPTIONS = ['pizza', 'sushi', 'salada'];

const env = {
  selfIds: [SELF, SELF_LID],
  pnForLid: async (): Promise<string | null> => null,
};

/** Cifra o voto como o WhatsApp: AES-256-GCM com a chave derivada do segredo e dos dois JIDs. */
function encryptVote(
  selected: readonly string[],
  ctx: { creator: string; voter: string; pollId: string; secret: Uint8Array },
): proto.Message.IPollEncValue {
  const plain = proto.Message.PollVoteMessage.encode({
    selectedOptions: selected.map((name) => createHash('sha256').update(name).digest()),
  }).finish();
  const sign = Buffer.concat([
    Buffer.from(ctx.pollId),
    Buffer.from(ctx.creator),
    Buffer.from(ctx.voter),
    Buffer.from('Poll Vote'),
    new Uint8Array([1]),
  ]);
  const key0 = createHmac('sha256', new Uint8Array(32)).update(ctx.secret).digest();
  const key = createHmac('sha256', key0).update(sign).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${ctx.pollId}\u0000${ctx.voter}`));
  const encPayload = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { encPayload, encIv: iv };
}

/** Enquete recebida de Alice no grupo. */
function poll(id = 'POLL-1'): WAMessage {
  return {
    key: { remoteJid: GROUP, id, fromMe: false, participant: ALICE },
    message: {
      messageContextInfo: { messageSecret: SECRET },
      pollCreationMessage: {
        name: 'Almoço?',
        options: OPTIONS.map((optionName) => ({ optionName })),
      },
    },
  };
}

/** Voto de `voter` na enquete `pollId`, cifrado com os JIDs que o aparelho dele usou. */
function voteMessage(
  selected: readonly string[],
  options: {
    pollId?: string;
    pollKey?: proto.IMessageKey;
    voter?: string;
    voterAlt?: string;
    creatorUsed?: string;
    voterUsed?: string;
    secret?: Uint8Array;
    fromMe?: boolean;
  } = {},
): WAMessage {
  const pollId = options.pollId ?? 'POLL-1';
  const voter = options.voter ?? ALICE;
  return {
    key: {
      remoteJid: GROUP,
      id: `VOTE-${Math.random()}`,
      fromMe: options.fromMe ?? false,
      participant: options.fromMe ? undefined : voter,
      participantAlt: options.voterAlt,
    },
    pushName: 'Alice',
    message: {
      pollUpdateMessage: {
        pollCreationMessageKey: options.pollKey ?? {
          remoteJid: GROUP,
          id: pollId,
          fromMe: false,
          participant: ALICE,
        },
        vote: encryptVote(selected, {
          creator: options.creatorUsed ?? ALICE,
          voter: options.voterUsed ?? voter,
          pollId,
          secret: options.secret ?? SECRET,
        }),
      },
    },
  };
}

describe('toPollVote', () => {
  it('decifra o voto e devolve os índices das opções marcadas, em ordem', async () => {
    const polls = new PollBook();
    polls.remember(poll());

    const vote = await toPollVote(voteMessage(['salada', 'pizza']), polls, env, new ContactBook());

    expect(vote).toEqual({
      chat: { id: GROUP, isGroup: true },
      messageId: 'POLL-1',
      sender: { id: ALICE, name: 'Alice', phone: '5511911110000' },
      options: [0, 2],
      fromMe: false,
    });
  });

  it('voto retirado vem com a lista vazia', async () => {
    const polls = new PollBook();
    polls.remember(poll());

    const vote = await toPollVote(voteMessage([]), polls, env, new ContactBook());

    expect(vote?.options).toEqual([]);
  });

  it('com LID, tenta o JID alternativo que o votante pode ter usado', async () => {
    const polls = new PollBook();
    polls.remember(poll());

    // A chave chega com o LID, mas o aparelho de quem votou cifrou com o telefone.
    const vote = await toPollVote(
      voteMessage(['sushi'], { voter: ALICE_LID, voterAlt: ALICE, voterUsed: ALICE }),
      polls,
      env,
      new ContactBook(),
    );

    expect(vote?.options).toEqual([1]);
    expect(vote?.sender.id).toBe(ALICE_LID);
  });

  it('o voto da própria sessão decifra com o JID da sessão e vem com fromMe', async () => {
    const polls = new PollBook();
    polls.remember(poll());

    const vote = await toPollVote(
      voteMessage(['pizza'], { fromMe: true, voterUsed: SELF_LID }),
      polls,
      env,
      new ContactBook(),
    );

    expect(vote).toMatchObject({ options: [0], fromMe: true, sender: { id: SELF } });
  });

  it('opção que a enquete não tem fica de fora', async () => {
    const polls = new PollBook();
    polls.remember(poll());

    const vote = await toPollVote(voteMessage(['pizza', 'lasanha']), polls, env, new ContactBook());

    expect(vote?.options).toEqual([0]);
  });

  it('enquete desconhecida devolve null', async () => {
    const vote = await toPollVote(voteMessage(['pizza']), new PollBook(), env, new ContactBook());

    expect(vote).toBeNull();
  });

  it('voto que não decifra lança', async () => {
    const polls = new PollBook();
    polls.remember(poll());

    await expect(
      toPollVote(
        voteMessage(['pizza'], { secret: new Uint8Array(32).fill(9) }),
        polls,
        env,
        new ContactBook(),
      ),
    ).rejects.toThrow('não decifrou');
  });

  it('o PollBook esquece a enquete mais antiga além do limite', async () => {
    const polls = new PollBook(2);
    polls.remember(poll('A'));
    polls.remember(poll('B'));
    polls.remember(poll('C'));

    expect(polls.get('A')).toBeUndefined();
    expect(polls.get('B')).toBeDefined();
    expect(polls.get('C')).toBeDefined();
  });

  it('mensagem sem segredo não é guardada', () => {
    const polls = new PollBook();
    const sem = poll();
    polls.remember({ ...sem, message: { pollCreationMessage: sem.message?.pollCreationMessage } });

    expect(polls.get('POLL-1')).toBeUndefined();
  });
});

describe('BaileysTransport: poll.vote', () => {
  function setup() {
    const driver = new FakeDriver();
    const lines: string[] = [];
    const log: Logger = {
      level: 'trace',
      trace: () => undefined,
      debug: (message) => void lines.push(message),
      info: () => undefined,
      warn: () => undefined,
      error: (message) => void lines.push(message),
      fatal: () => undefined,
      child: () => log,
    };
    const deps: TransportDeps = {
      session: 'default',
      auth: createMemoryStorage().authState('default'),
      log,
    };
    const transport = new BaileysTransport({ pairing: 'qr', driver }, deps);
    const votes: TransportEvents['poll.vote'][] = [];
    transport.on('poll.vote', (vote) => void votes.push(vote));
    return { driver, transport, votes, lines };
  }

  async function open() {
    const ctx = setup();
    await ctx.transport.connect();
    const socket = ctx.driver.last;
    socket.updateCreds({ me: { id: '5511999990000:3@s.whatsapp.net', lid: SELF_LID } });
    socket.user = { id: '5511999990000:3@s.whatsapp.net' };
    socket.emit('connection.update', { connection: 'open' });
    return { ...ctx, socket };
  }

  /** Voto de Alice na enquete enviada pela sessão. */
  function voteOnSent(id: string, secret: Uint8Array, selected: readonly string[]): WAMessage {
    return voteMessage(selected, {
      pollId: id,
      pollKey: { remoteJid: GROUP, id, fromMe: true },
      creatorUsed: SELF,
      secret,
    });
  }

  it('o voto na enquete enviada pela sessão vira poll.vote', async () => {
    const { transport, socket, votes } = await open();
    const key = await transport.send(GROUP, {
      type: 'poll',
      name: 'Almoço?',
      options: OPTIONS,
    });

    socket.emit('messages.upsert', {
      messages: [voteOnSent(key.id, socket.pollSecret, ['sushi'])],
      type: 'notify',
    });

    await expect.poll(() => votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({ messageId: key.id, options: [1], fromMe: false });
  });

  it('a enquete recebida também tem os votos decifrados', async () => {
    const { socket, votes } = await open();

    socket.emit('messages.upsert', { messages: [poll()], type: 'notify' });
    socket.emit('messages.upsert', { messages: [voteMessage(['pizza'])], type: 'notify' });

    await expect.poll(() => votes).toHaveLength(1);
    expect(votes[0]?.options).toEqual([0]);
  });

  it('depois do disconnect(), a enquete é esquecida e o voto descartado', async () => {
    const { transport, driver, socket, votes, lines } = await open();
    const key = await transport.send(GROUP, { type: 'poll', name: 'Almoço?', options: OPTIONS });
    await transport.disconnect();
    await transport.connect();

    driver.last.emit('messages.upsert', {
      messages: [voteOnSent(key.id, socket.pollSecret, ['pizza'])],
      type: 'notify',
    });

    await expect.poll(() => lines).toContain('voto de enquete desconhecida; descartado');
    expect(votes).toEqual([]);
  });
});
