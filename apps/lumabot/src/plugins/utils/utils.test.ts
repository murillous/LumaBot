import { definePlugin } from '@usebridger/core';
import { createTestBot, DEFAULT_SENDER, FakeTransport, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
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
      `📱 *Informações de ID*\n\n👤 *Seu Número:* ${DEFAULT_SENDER.phone}\n💬 *ID deste Chat:* chat@fake`,
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

    expect(bot.sent).toHaveReplied(
      '📱 *Informações de ID*\n\n👤 *Seu Número:* u-42\n💬 *ID deste Chat:* chat@fake',
    );
  });

  it('plugin que só contribui acrescenta linha, sem tocar no utils', async () => {
    bot = await createTestBot({ plugins: [utils, liner(() => '🏷️ Apelido: Ana')] });

    await bot.receive({ text: '!meunumero' });

    expect(bot.sent).toHaveReplied(
      `📱 *Informações de ID*\n\n👤 *Seu Número:* ${DEFAULT_SENDER.phone}\n💬 *ID deste Chat:* chat@fake\n🏷️ Apelido: Ana`,
    );
  });

  it('linha null é omitida', async () => {
    bot = await createTestBot({ plugins: [utils, liner(() => null)] });

    await bot.receive({ text: '!meunumero' });

    expect(bot.sent).toHaveReplied(
      `📱 *Informações de ID*\n\n👤 *Seu Número:* ${DEFAULT_SENDER.phone}\n💬 *ID deste Chat:* chat@fake`,
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
      `📱 *Informações de ID*\n\n👤 *Seu Número:* ${DEFAULT_SENDER.phone}\n💬 *ID deste Chat:* chat@fake`,
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

  it('troca o prefixo do chat; o antigo deixa de responder', async () => {
    await adminBot();

    await bot.receive({ text: '!prefixo ?', chat: group });
    expect(bot.sent).toHaveReplied('✅ Prefixo deste chat agora é "?".');

    await bot.receive({ text: '?meunumero', chat: group });
    expect(bot.sent).toHaveLength(2);

    await bot.receive({ text: '!meunumero', chat: group });
    expect(bot.sent).toHaveLength(2);
  });

  it('mostra o prefixo que o kernel gravou (minúsculo)', async () => {
    await adminBot();

    await bot.receive({ text: '!prefixo AB', chat: group });

    expect(bot.sent).toHaveReplied('✅ Prefixo deste chat agora é "ab".');
  });

  it('sem argumento volta ao padrão', async () => {
    await adminBot();
    await bot.receive({ text: '!prefixo ?', chat: group });

    await bot.receive({ text: '?prefixo', chat: group });

    expect(bot.sent).toHaveReplied('✅ Prefixo deste chat voltou ao padrão ("!").');
  });

  it.each([
    ['vazio entre aspas', '!prefixo ""'],
    ['várias palavras', '!prefixo a b'],
    ['longo demais', '!prefixo abcdef'],
    ['começado por espaço', '!prefixo " x"'],
  ])('recusa prefixo inválido (%s) e mantém o atual', async (_nome, text) => {
    await adminBot();

    await bot.receive({ text, chat: group });

    expect(bot.sent).toHaveReplied('❌ Use !prefixo <símbolo>: de 1 a 5 caracteres, sem espaço.');
    await bot.receive({ text: '!meunumero', chat: group });
    expect(bot.sent).toHaveLength(2);
  });

  it('quem não é admin do grupo não troca e recebe o aviso', async () => {
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
    expect(bot.sent).toHaveReplied('❌ Só admin pode trocar o prefixo, e dentro do grupo.');

    await bot.receive({ text: '!meunumero', chat: group });
    expect(bot.sent).toHaveLength(2);
  });

  it('em DM recebe o aviso', async () => {
    bot = await createTestBot({ plugins: [utils] });

    await bot.receive({ text: '!prefixo ?' });

    expect(bot.sent).toHaveReplied('❌ Só admin pode trocar o prefixo, e dentro do grupo.');
  });
});

it('tool chat_info devolve as linhas do !meunumero, com as contribuídas', async () => {
  bot = await createTestBot({ plugins: [utils, liner(() => '🏷️ Apelido: Ana'), aiToolsProbe] });

  await bot.receive({ text: '!tool chat_info' });

  expect(toolResult(bot)).toEqual({
    ok: true,
    lines: [
      `👤 *Seu Número:* ${DEFAULT_SENDER.phone}`,
      '💬 *ID deste Chat:* chat@fake',
      '🏷️ Apelido: Ana',
    ],
  });
});
