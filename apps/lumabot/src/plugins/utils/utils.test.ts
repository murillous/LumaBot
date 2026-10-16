import { definePlugin } from '@usebridger/core';
import { createTestBot, DEFAULT_SENDER, FakeTransport, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { utils } from './utils.ts';

let bot: TestBot;
afterEach(() => bot.stop());

/** Plugin de outro dono que acrescenta uma linha ao `!meunumero`, como o futuro `user-names`. */
function liner(line: () => string | null | Promise<string | null>) {
  return definePlugin({
    name: 'liner',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { utils: '^1.0.0' },
    setup: (ctx) => ctx.services.contribute('utils.info', line),
  });
}

describe('!meunumero', () => {
  it('responde com o telefone do remetente e o ID do chat', async () => {
    bot = await createTestBot({ plugins: [utils] });

    await bot.receive({ text: '!meunumero' });

    expect(bot.sent).toHaveReplied(
      `📱 Seu número: ${DEFAULT_SENDER.phone}\n💬 ID deste chat: chat@fake`,
    );
  });

  it('o alias !meuid faz o mesmo', async () => {
    bot = await createTestBot({ plugins: [utils] });

    await bot.receive({ text: '!meuid' });

    expect(bot.sent).toHaveLength(1);
  });

  it('sem telefone (outra plataforma), usa o ID do remetente', async () => {
    bot = await createTestBot({ plugins: [utils] });

    await bot.receive({ text: '!meunumero', sender: { id: 'u-42', phone: null } });

    expect(bot.sent).toHaveReplied('📱 Seu número: u-42\n💬 ID deste chat: chat@fake');
  });

  it('plugin que só contribui acrescenta linha, sem tocar no utils', async () => {
    bot = await createTestBot({ plugins: [utils, liner(() => '🏷️ Apelido: Ana')] });

    await bot.receive({ text: '!meunumero' });

    expect(bot.sent).toHaveReplied(
      `📱 Seu número: ${DEFAULT_SENDER.phone}\n💬 ID deste chat: chat@fake\n🏷️ Apelido: Ana`,
    );
  });

  it('linha null é omitida', async () => {
    bot = await createTestBot({ plugins: [utils, liner(() => null)] });

    await bot.receive({ text: '!meunumero' });

    expect(bot.sent).toHaveReplied(
      `📱 Seu número: ${DEFAULT_SENDER.phone}\n💬 ID deste chat: chat@fake`,
    );
  });

  it('contribuição que lança é omitida e não derruba o comando', async () => {
    bot = await createTestBot({
      plugins: [
        utils,
        liner(() => {
          throw new Error('quebrou');
        }),
      ],
    });

    await bot.receive({ text: '!meunumero' });

    expect(bot.sent).toHaveReplied(
      `📱 Seu número: ${DEFAULT_SENDER.phone}\n💬 ID deste chat: chat@fake`,
    );
  });
});

describe('!prefixo', () => {
  const group = { id: 'grupo@fake', isGroup: true };

  async function adminBot() {
    const transport = new FakeTransport();
    transport.setGroup({
      id: group.id,
      title: 'Grupo',
      description: null,
      ownerId: null,
      participants: [
        { id: DEFAULT_SENDER.id, name: null, phone: null, isAdmin: true, isSuperAdmin: false },
      ],
    });
    bot = await createTestBot({ transport, plugins: [utils] });
  }

  it('troca o prefixo do chat e o comando passa a responder só com o novo', async () => {
    await adminBot();

    await bot.receive({ text: '!prefixo ?', chat: group });
    expect(bot.sent).toHaveReplied('✅ Prefixo deste chat agora é "?".');

    await bot.receive({ text: '?meunumero', chat: group });
    expect(bot.sent).toHaveLength(2);
  });

  it('sem argumento volta ao padrão', async () => {
    await adminBot();
    await bot.receive({ text: '!prefixo ?', chat: group });

    await bot.receive({ text: '?prefixo', chat: group });

    expect(bot.sent).toHaveReplied('✅ Prefixo deste chat voltou ao padrão ("!").');
  });

  it('prefixo começado por espaço vira mensagem amigável', async () => {
    await adminBot();

    await bot.receive({ text: '!prefixo " x"', chat: group });

    expect(bot.sent).toHaveReplied('❌ Prefixo inválido: não pode começar com espaço.');
  });

  it('quem não é admin do grupo não troca', async () => {
    const transport = new FakeTransport();
    transport.setGroup({
      id: group.id,
      title: 'Grupo',
      description: null,
      ownerId: null,
      participants: [
        { id: DEFAULT_SENDER.id, name: null, phone: null, isAdmin: false, isSuperAdmin: false },
      ],
    });
    bot = await createTestBot({ transport, plugins: [utils] });

    await bot.receive({ text: '!prefixo ?', chat: group });

    expect(bot.sent).not.toHaveReplied('✅ Prefixo deste chat agora é "?".');
  });
});
