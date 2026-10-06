import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupService } from '../../../../src/core/services/GroupService.js';

function makeParticipants(withAdmin = true) {
  return [
    { id: '111@s.whatsapp.net', admin: withAdmin ? 'admin' : null },
    { id: '222@s.whatsapp.net', admin: null },
    { id: '333@s.whatsapp.net', admin: null },
  ];
}

function makeBot(overrides = {}) {
  return {
    jid: 'group@g.us',
    isGroup: true,
    raw: { key: { remoteJid: 'group@g.us' }, participant: '111@s.whatsapp.net' },
    socket: {
      groupMetadata: vi.fn().mockResolvedValue({ participants: makeParticipants() }),
      sendMessage: vi.fn().mockResolvedValue({}),
    },
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('GroupService.mentionAll', () => {
  it('avisa que só funciona em grupos quando em PV', async () => {
    const bot = makeBot({ isGroup: false });
    await GroupService.mentionAll(bot);
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('grupos'));
    expect(bot.socket.sendMessage).not.toHaveBeenCalled();
  });

  it('avisa que apenas admins podem usar o comando', async () => {
    const bot = makeBot();
    // Participante sender não é admin
    bot.raw.participant = '222@s.whatsapp.net';
    bot.socket.groupMetadata.mockResolvedValue({ participants: makeParticipants(false) });

    await GroupService.mentionAll(bot);
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('administradores'));
  });

  it('menciona todos os participantes quando sender é admin', async () => {
    const bot = makeBot();
    await GroupService.mentionAll(bot);

    expect(bot.socket.sendMessage).toHaveBeenCalledWith(
      bot.jid,
      expect.objectContaining({
        text: expect.stringContaining('Atenção geral'),
        mentions: expect.arrayContaining(['111@s.whatsapp.net']),
      }),
    );
  });

  it('trata erro de groupMetadata com reply de erro', async () => {
    const bot = makeBot();
    bot.socket.groupMetadata.mockRejectedValue(new Error('falha de rede'));

    await GroupService.mentionAll(bot);
    expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('Erro'));
  });
});

describe('GroupService.isAdmin', () => {
  it('retorna true quando participante é admin', async () => {
    const sock = {
      groupMetadata: vi.fn().mockResolvedValue({ participants: makeParticipants(true) }),
    };
    const result = await GroupService.isAdmin(sock, 'group@g.us', '111@s.whatsapp.net');
    expect(result).toBe(true);
  });

  it('retorna false quando participante não é admin', async () => {
    const sock = {
      groupMetadata: vi.fn().mockResolvedValue({ participants: makeParticipants(true) }),
    };
    const result = await GroupService.isAdmin(sock, 'group@g.us', '222@s.whatsapp.net');
    expect(result).toBe(false);
  });

  it('retorna false quando participante não existe no grupo', async () => {
    const sock = {
      groupMetadata: vi.fn().mockResolvedValue({ participants: makeParticipants() }),
    };
    const result = await GroupService.isAdmin(sock, 'group@g.us', 'naoexiste@s.whatsapp.net');
    expect(result).toBe(false);
  });

  it('retorna false em caso de erro', async () => {
    const sock = {
      groupMetadata: vi.fn().mockRejectedValue(new Error('erro')),
    };
    const result = await GroupService.isAdmin(sock, 'group@g.us', '111@s.whatsapp.net');
    expect(result).toBe(false);
  });
});
