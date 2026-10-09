import { bold, UnsupportedError } from '@zapforge/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SELF, FakeTransport } from './fake-transport.ts';
import { buildMessage } from './incoming.ts';

const GROUP = {
  id: 'grupo@fake',
  title: 'Grupo',
  description: null,
  ownerId: 'dona@fake',
  participants: [],
};

describe('FakeTransport', () => {
  it('self só existe depois do connect(); connect e disconnect publicam o status', async () => {
    const transport = new FakeTransport();
    const statuses: string[] = [];
    transport.on('connection.status', (s) => void statuses.push(s.status));

    expect(transport.self).toBeNull();
    await transport.connect();
    expect(transport.self).toEqual(DEFAULT_SELF);
    await transport.disconnect();
    await transport.disconnect();

    expect(statuses).toEqual(['open', 'closed']);
  });

  it('registra envios com a citação, as menções e a chave devolvida', async () => {
    const transport = new FakeTransport();
    const quoted = buildMessage({ text: 'oi' });

    const key = await transport.send(
      'chat@fake',
      { type: 'text', text: 'olá' },
      { quoted, mentions: ['user@fake'] },
    );

    expect(transport.sent).toEqual([
      {
        chatId: 'chat@fake',
        content: { type: 'text', text: 'olá' },
        quoted,
        mentions: ['user@fake'],
        key,
      },
    ]);
  });

  it('expõe os `limits` e registra a árvore da edição formatada (ADR 0061)', async () => {
    expect(new FakeTransport().limits).toBeUndefined();
    const transport = new FakeTransport({ limits: { text: 10 } });
    expect(transport.limits).toEqual({ text: 10 });
    const key = await transport.send('chat@fake', { type: 'text', text: 'a' });
    await transport.edit(key, 'b', bold('b'));
    expect(transport.edits).toEqual([{ key, text: 'b', formatted: bold('b') }]);
  });

  it('registra reações, edições, deleções, presença e participantes', async () => {
    const transport = new FakeTransport();
    const key = await transport.send('chat@fake', { type: 'text', text: 'a' });

    await transport.react(key, '👍');
    await transport.edit(key, 'b');
    await transport.delete(key);
    await transport.sendPresence('chat@fake', 'composing');
    await transport.updateGroupParticipants('grupo@fake', ['x@fake'], 'remove');

    expect(transport.reactions).toEqual([{ key, emoji: '👍' }]);
    expect(transport.edits).toEqual([{ key, text: 'b' }]);
    expect(transport.deletions).toEqual([key]);
    expect(transport.presences).toEqual([{ chatId: 'chat@fake', presence: 'composing' }]);
    expect(transport.participantUpdates).toEqual([
      { groupId: 'grupo@fake', participantIds: ['x@fake'], action: 'remove' },
    ]);

    transport.clear();
    expect(transport.sent).toEqual([]);
    expect(transport.reactions).toEqual([]);
  });

  it('lança UnsupportedError fora das capabilities declaradas', async () => {
    const transport = new FakeTransport({ capabilities: ['send.text'] });
    const key = { chatId: 'chat@fake', id: 'm1', fromMe: false, senderId: null };

    await expect(
      transport.send('chat@fake', { type: 'sticker', media: Buffer.from('x') }),
    ).rejects.toBeInstanceOf(UnsupportedError);
    await expect(transport.react(key, '👍')).rejects.toBeInstanceOf(UnsupportedError);
    expect(transport.sent).toEqual([]);
  });

  it('getGroupMetadata devolve os grupos registrados e falha nos desconhecidos', async () => {
    const transport = new FakeTransport({ groups: [GROUP] });

    await expect(transport.getGroupMetadata('grupo@fake')).resolves.toEqual(GROUP);
    await expect(transport.getGroupMetadata('outro@fake')).rejects.toThrow(/setGroup/);

    transport.setGroup({ ...GROUP, id: 'outro@fake' });
    await expect(transport.getGroupMetadata('outro@fake')).resolves.toMatchObject({
      id: 'outro@fake',
    });
  });
});
