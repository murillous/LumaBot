import { WAMessageStubType } from 'baileys';
import { describe, expect, it } from 'vitest';
import {
  ContactBook,
  toDeleted,
  toEdited,
  toGroupUpdated,
  toParticipantEvents,
  toReaction,
} from './events.ts';
import type { NormalizeEnv } from './normalize.ts';

const GROUP = '120363000000000001@g.us';
const ALICE = '5511911110000@s.whatsapp.net';
const BOB_LID = '222222222222222@lid';
const BOB = '5521922220000@s.whatsapp.net';
const SELF = '5511999990000@s.whatsapp.net';
const SELF_LID = '999999999999999@lid';

const env: NormalizeEnv = {
  selfIds: [SELF, SELF_LID],
  pnForLid: async (lid) => (lid === BOB_LID ? BOB : null),
  download: async () => Buffer.from('mídia'),
  stream: async () => new ReadableStream(),
};

describe('ContactBook', () => {
  it('primeira aparição sai com o que se sabe; repetida não sai', () => {
    const book = new ContactBook();
    expect(book.observe({ id: ALICE, name: 'Alice', phone: '5511911110000' })).toEqual({
      id: ALICE,
      name: 'Alice',
      phone: '5511911110000',
    });
    expect(book.observe({ id: ALICE, name: 'Alice', phone: '5511911110000' })).toBeNull();
  });

  it('mudança sai só com o campo alterado; null não apaga o que se sabia', () => {
    const book = new ContactBook();
    book.observe({ id: BOB_LID, name: 'Bob', phone: null });
    expect(book.observe({ id: BOB_LID, name: null, phone: '5521922220000' })).toEqual({
      id: BOB_LID,
      phone: '5521922220000',
    });
    expect(book.observe({ id: BOB_LID, name: 'Roberto', phone: null })).toEqual({
      id: BOB_LID,
      name: 'Roberto',
    });
    expect(book.nameOf(BOB_LID)).toBe('Roberto');
  });

  it('contato sem nome nem telefone não gera evento', () => {
    expect(new ContactBook().observe({ id: ALICE, name: null, phone: null })).toBeNull();
  });

  it('named completa o nome que o evento não trouxe', () => {
    const book = new ContactBook();
    book.observe({ id: ALICE, name: 'Alice', phone: null });
    expect(book.named({ id: ALICE, name: null, phone: null }).name).toBe('Alice');
    expect(book.named({ id: ALICE, name: 'Outra', phone: null }).name).toBe('Outra');
  });
});

describe('toReaction', () => {
  it('reação em grupo: autor da mensagem de reação, com telefone do LID e nome conhecido', async () => {
    const book = new ContactBook();
    book.observe({ id: BOB_LID, name: 'Bob', phone: null });
    const reaction = await toReaction(
      {
        key: { remoteJid: GROUP, id: 'ALVO', fromMe: true },
        reaction: {
          text: '👍',
          key: { remoteJid: GROUP, id: 'R1', fromMe: false, participant: BOB_LID },
        },
      },
      env,
      book,
    );
    expect(reaction).toEqual({
      chat: { id: GROUP, isGroup: true },
      messageId: 'ALVO',
      sender: { id: BOB_LID, name: 'Bob', phone: '5521922220000' },
      emoji: '👍',
      fromMe: false,
    });
  });

  it('texto vazio é reação removida; da sessão na conversa privada, o autor é a sessão', async () => {
    const reaction = await toReaction(
      {
        key: { remoteJid: ALICE, id: 'ALVO', fromMe: false },
        reaction: { text: '', key: { remoteJid: ALICE, id: 'R1', fromMe: true } },
      },
      env,
      new ContactBook(),
    );
    expect(reaction).toMatchObject({ emoji: null, fromMe: true, sender: { id: SELF } });
  });

  it('status e reação sem chave ficam de fora', async () => {
    const book = new ContactBook();
    const status = 'status@broadcast';
    expect(
      await toReaction(
        {
          key: { remoteJid: status, id: 'A' },
          reaction: { text: '❤', key: { remoteJid: status, participant: ALICE } },
        },
        env,
        book,
      ),
    ).toBeNull();
    expect(
      await toReaction({ key: { remoteJid: ALICE, id: 'A' }, reaction: { text: '❤' } }, env, book),
    ).toBeNull();
  });
});

describe('toEdited', () => {
  it('vira Message com isEdited, o texto novo, o horário da edição e o nome conhecido', async () => {
    const book = new ContactBook();
    book.observe({ id: ALICE, name: 'Alice', phone: null });
    const message = await toEdited(
      {
        key: { remoteJid: GROUP, id: 'M1', fromMe: false, participant: ALICE },
        update: {
          message: {
            editedMessage: {
              message: { ephemeralMessage: { message: { conversation: 'corrigido' } } },
            },
          },
          messageTimestamp: 1_760_000_100,
        },
      },
      env,
      book,
    );
    expect(message).toMatchObject({
      id: 'M1',
      type: 'text',
      text: 'corrigido',
      isEdited: true,
      timestamp: 1_760_000_100_000,
      sender: { id: ALICE, name: 'Alice', phone: '5511911110000' },
    });
  });

  it('update que não é edição devolve null', async () => {
    expect(
      await toEdited(
        { key: { remoteJid: ALICE, id: 'M1' }, update: { status: 3 } },
        env,
        new ContactBook(),
      ),
    ).toBeNull();
  });
});

describe('toDeleted', () => {
  it('quem apagou é o autor da mensagem de apagamento (admin em grupo)', async () => {
    const deleted = await toDeleted(
      {
        key: { remoteJid: GROUP, id: 'M1', fromMe: false, participant: BOB_LID },
        update: {
          message: null,
          messageStubType: WAMessageStubType.REVOKE,
          key: { remoteJid: GROUP, id: 'REVOKE1', fromMe: false, participant: BOB_LID },
        },
      },
      env,
      new ContactBook(),
    );
    expect(deleted).toEqual({
      chat: { id: GROUP, isGroup: true },
      messageId: 'M1',
      deletedBy: { id: BOB_LID, name: null, phone: '5521922220000' },
      fromMe: false,
    });
  });

  it('apagada pela sessão sai com fromMe', async () => {
    const deleted = await toDeleted(
      {
        key: { remoteJid: ALICE, id: 'M1', fromMe: true },
        update: {
          messageStubType: WAMessageStubType.REVOKE,
          key: { remoteJid: ALICE, id: 'R', fromMe: true },
        },
      },
      env,
      new ContactBook(),
    );
    expect(deleted).toMatchObject({ fromMe: true, deletedBy: { id: SELF } });
  });
});

describe('toParticipantEvents', () => {
  it('participantes com telefone e autor resolvidos', async () => {
    const events = await toParticipantEvents(
      {
        id: GROUP,
        author: BOB_LID,
        participants: [{ id: '333@lid', phoneNumber: '5531933330000@s.whatsapp.net' }],
        action: 'add',
      },
      env,
      new ContactBook(),
    );
    expect(events).toEqual({
      self: null,
      others: {
        chat: { id: GROUP, isGroup: true },
        action: 'add',
        participants: [{ id: '333@lid', name: null, phone: '5531933330000' }],
        actor: { id: BOB_LID, name: null, phone: '5521922220000' },
      },
    });
  });

  it('sessão adicionada vira group.joined e sai da lista; removida, group.left', async () => {
    const book = new ContactBook();
    const joined = await toParticipantEvents(
      {
        id: GROUP,
        author: ALICE,
        participants: [{ id: SELF_LID, phoneNumber: SELF }, { id: BOB_LID }],
        action: 'add',
      },
      env,
      book,
    );
    expect(joined.self).toBe('group.joined');
    expect(joined.others?.participants.map((p) => p.id)).toEqual([BOB_LID]);

    const left = await toParticipantEvents(
      { id: GROUP, author: ALICE, participants: [{ id: SELF }], action: 'remove' },
      env,
      book,
    );
    expect(left).toEqual({ self: 'group.left', others: null });
  });

  it('sessão promovida segue em group.participants; modify não tem evento', async () => {
    const book = new ContactBook();
    const promoted = await toParticipantEvents(
      { id: GROUP, author: ALICE, participants: [{ id: SELF }], action: 'promote' },
      env,
      book,
    );
    expect(promoted.self).toBeNull();
    expect(promoted.others?.participants.map((p) => p.id)).toEqual([SELF]);

    expect(
      await toParticipantEvents(
        { id: GROUP, author: ALICE, participants: [{ id: ALICE }], action: 'modify' },
        env,
        book,
      ),
    ).toEqual({ self: null, others: null });
  });
});

describe('toGroupUpdated', () => {
  it('só os campos alterados; descrição removida vira null', () => {
    expect(toGroupUpdated({ id: GROUP, subject: 'Novo' })).toEqual({
      chat: { id: GROUP, isGroup: true },
      title: 'Novo',
    });
    expect(toGroupUpdated({ id: GROUP, desc: undefined })).toEqual({
      chat: { id: GROUP, isGroup: true },
      description: null,
    });
    expect(toGroupUpdated({ id: GROUP, announce: true, restrict: false })).toEqual({
      chat: { id: GROUP, isGroup: true },
      announce: true,
      restrict: false,
    });
  });

  it('metadados completos da sincronização e campos sem evento ficam de fora', () => {
    expect(toGroupUpdated({ id: GROUP, subject: 'Igual', participants: [] })).toBeNull();
    expect(toGroupUpdated({ id: GROUP, inviteCode: 'abc' })).toBeNull();
    expect(toGroupUpdated({ subject: 'Sem id' })).toBeNull();
  });
});
