import { bold, command, definePlugin, fmt, type Message } from '@zapforge/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeTransport } from './fake-transport.ts';
import { DEFAULT_CHAT, DEFAULT_SENDER } from './incoming.ts';
import { createTestBot, type TestBot } from './test-bot.ts';
// Registra os matchers, como o import do pacote faz para o autor de plugin.
import './matchers.ts';

const ENGINE = '>=0.0.0';
const bots: TestBot[] = [];

async function testBot(...args: Parameters<typeof createTestBot>): Promise<TestBot> {
  const bot = await createTestBot(...args);
  bots.push(bot);
  return bot;
}

afterEach(async () => {
  for (const bot of bots.splice(0)) await bot.stop();
});

/** O plugin do exemplo do plano (§6.2): figurinha da própria mídia ou da citada. */
const sticker = () =>
  definePlugin({
    name: 'sticker',
    version: '1.0.0',
    engine: ENGINE,
    requires: ['media.download', 'send.sticker'],
    setup(ctx) {
      ctx.commands.add(
        command({
          name: 'sticker',
          aliases: ['s'],
          accepts: ['image', 'video', 'quoted:image', 'quoted:video'],
          onReject: () => 'Mande ou responda uma imagem/vídeo 🙂',
          run: async (c) => {
            const media = c.media;
            if (media === null) throw new Error('accepts garante a mídia');
            await c.reply.sticker(await media.download());
          },
        }),
      );
    },
  });

const ping = () =>
  definePlugin({
    name: 'ping',
    version: '1.0.0',
    engine: ENGINE,
    setup(ctx) {
      ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
    },
  });

describe('createTestBot', () => {
  it('roda o exemplo do plano (§6.9): imagem com legenda !s vira figurinha', async () => {
    const image = Buffer.from('jpeg falso');
    const bot = await testBot({ plugins: [sticker()] });

    await bot.receive({ text: '!s', image });

    expect(bot.sent).toContainSticker();
    const [sent] = bot.sent;
    expect(sent?.content).toEqual({ type: 'sticker', media: image });
  });

  it('entrega a mídia da mensagem citada', async () => {
    const image = Buffer.from('citada');
    const bot = await testBot({ plugins: [sticker()] });

    await bot.receive({ text: '!s', quoted: { image } });

    expect(bot.sent[0]?.content).toEqual({ type: 'sticker', media: image });
  });

  it('receive() resolve com a resposta já em sent, citando a mensagem recebida', async () => {
    const bot = await testBot({ plugins: [ping()] });

    const message = await bot.receive({ text: '!ping' });

    expect(bot).toHaveReplied('pong');
    expect(bot.sent[0]?.quoted).toBe(message);
    expect(bot.sent[0]?.chatId).toBe(DEFAULT_CHAT.id);
  });

  it('o comando recusado responde com o onReject', async () => {
    const bot = await testBot({ plugins: [sticker()] });

    await bot.receive({ text: '!s' });

    expect(bot.sent).toHaveReplied('Mande ou responda uma imagem/vídeo 🙂');
    expect(bot.sent).not.toContainSticker();
  });

  it('remetente padrão tem telefone, então owners funciona', async () => {
    const plugin = definePlugin({
      name: 'admin',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(command({ name: 'config', role: 'owner', run: (c) => c.reply('ok') }));
      },
    });
    const bot = await testBot({ plugins: [plugin], owners: [DEFAULT_SENDER.phone ?? ''] });

    await bot.receive({ text: '!config', sender: { phone: '5511000000000' } });
    expect(bot.sent).not.toContainText('ok');

    await bot.receive({ text: '!config' });
    expect(bot.sent).toContainText('ok');
  });

  it('remetente sem telefone, com username e claims, chega ao plugin (ADR 0057)', async () => {
    const plugin = definePlugin({
      name: 'perfil',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'perfil',
            role: 'owner',
            run: (c) => {
              const { username, claims } = c.message.sender;
              return c.reply(`@${username ?? '?'} ${String(claims?.['papel'] ?? 'sem papel')}`);
            },
          }),
        );
      },
    });
    const bot = await testBot({ plugins: [plugin], owners: [{ id: 'u-42' }] });

    await bot.receive({
      text: '!perfil',
      sender: { id: 'u-42', phone: null, username: 'ana', claims: { papel: 'diretora' } },
    });
    expect(bot.sent).toContainText('@ana diretora');
  });

  it('chat de thread, com espaço e título, chega ao plugin e a resposta vai ao chat.id (ADR 0058)', async () => {
    const plugin = definePlugin({
      name: 'onde',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'onde',
            run: (c) => {
              const { kind, parentId, title } = c.message.chat;
              return c.reply(`${kind ?? '?'} ${parentId ?? '?'} ${title ?? '?'}`);
            },
          }),
        );
      },
    });
    const bot = await testBot({ plugins: [plugin] });

    await bot.receive({
      text: '!onde',
      chat: {
        id: '-100123/45',
        isGroup: true,
        kind: 'thread',
        parentId: '-100123',
        title: 'Avisos',
      },
    });
    expect(bot.sent).toContainText('thread -100123 Avisos');
    expect(bot.sent[0]?.chatId).toBe('-100123/45');
  });

  it('mensagem de outro bot não roda comando', async () => {
    const bot = await testBot({ plugins: [ping()] });

    await bot.receive({ text: '!ping', sender: { isBot: true } });
    expect(bot.sent).toHaveLength(0);
  });

  it('respeita as capabilities do FakeTransport: plugin sem a capability não carrega', async () => {
    const transport = new FakeTransport({ capabilities: ['send.text', 'quoted'] });
    const bot = await testBot({ transport, plugins: [sticker(), ping()] });

    expect(bot.bot.plugins().find((entry) => entry.name === 'sticker')).toMatchObject({
      status: 'skipped',
      reason: { kind: 'capabilities' },
    });
    await bot.receive({ text: '!ping' });
    expect(bot.sent).toHaveReplied('pong');
  });

  it('emit() entrega eventos que não são mensagem e espera os listeners', async () => {
    const reactions: (string | null)[] = [];
    const plugin = definePlugin({
      name: 'reacoes',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('reaction', (e) => {
          reactions.push(e.payload.emoji);
        });
      },
    });
    const bot = await testBot({ plugins: [plugin] });

    await bot.emit('reaction', {
      chat: DEFAULT_CHAT,
      messageId: 'm1',
      sender: DEFAULT_SENDER,
      emoji: '👍',
      fromMe: false,
    });

    expect(reactions).toEqual(['👍']);
  });

  it('chat como string vira conversa privada', async () => {
    const seen: Message[] = [];
    const plugin = definePlugin({
      name: 'eco',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('message', async (c) => {
          seen.push(c.message);
        });
      },
    });
    const bot = await testBot({ plugins: [plugin] });

    await bot.receive({ text: 'oi', chat: 'outro@fake' });

    expect(seen.map((m) => m.chat)).toEqual([{ id: 'outro@fake', isGroup: false }]);
  });
});

describe('createTestBot: conversa com resposta esperada (ADR 0060)', () => {
  it('cada receive assenta: a pergunta sai antes da resposta, e a resposta vai ao passo', async () => {
    const notas = definePlugin({
      name: 'notas',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'notas',
            run: async (c) => {
              await c.reply('De qual aluno?');
              c.expectReply('aluno');
            },
          }),
        );
        ctx.conversations.define('aluno', (c) => c.reply(`Notas de ${c.text}`));
      },
    });
    const bot = await testBot({ plugins: [notas] });

    await bot.receive({ text: '!notas' });
    expect(bot.sent).toContainText('De qual aluno?');
    await bot.receive({ text: 'Maria' });

    expect(bot.sent).toContainText('Notas de Maria');
  });
});

describe('createTestBot: texto formatado e limites (ADR 0061)', () => {
  const notas = () =>
    definePlugin({
      name: 'notas',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'notas',
            run: (c) => c.reply(fmt`Notas de ${bold('Maria')}\n\n${'8 '.repeat(10).trim()}`),
          }),
        );
      },
    });

  it('o matcher casa o texto visível da resposta formatada', async () => {
    const bot = await testBot({ plugins: [notas()] });
    await bot.receive({ text: '!notas' });
    expect(bot).toHaveReplied('Notas de Maria\n\n8 8 8 8 8 8 8 8 8 8');
    expect(bot.sent[0]?.content).toMatchObject({ formatted: { type: 'formatted' } });
  });

  it('com `limits` no FakeTransport, a resposta longa sai em partes', async () => {
    const transport = new FakeTransport({ limits: { text: 15 } });
    const bot = await testBot({ plugins: [notas()], transport });
    await bot.receive({ text: '!notas' });
    expect(bot.sent.map((s) => (s.content.type === 'text' ? s.content.text : ''))).toEqual([
      'Notas de Maria',
      '8 8 8 8 8 8 8 8',
      '8 8',
    ]);
    // Só a primeira parte cita a mensagem.
    expect(bot.sent.map((s) => s.quoted !== null)).toEqual([true, false, false]);
  });
});

describe('createTestBot: botões (ADR 0062)', () => {
  const escola = () =>
    definePlugin({
      name: 'escola',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'menu',
            run: (c) =>
              c.reply('Escolha:', {
                actions: [{ label: 'Notas', command: 'notas', args: ['Ana'] }],
              }),
          }),
        );
        ctx.commands.add(
          command({
            name: 'notas',
            run: (c) => c.reply(`notas de ${c.args[0]} por ${c.message.sender.id}`),
          }),
        );
      },
    });

  it('click() clica no botão pelo rótulo e espera a resposta', async () => {
    const bot = await testBot({ plugins: [escola()] });
    await bot.receive({ text: '!menu' });
    const menu = bot.sent[0];
    expect(menu?.actions?.map((action) => action.label)).toEqual(['Notas']);

    await bot.click(menu as NonNullable<typeof menu>, 'Notas', { sender: { id: 'outra@fake' } });

    expect(bot.sent.at(-1)?.content).toEqual({ type: 'text', text: 'notas de Ana por outra@fake' });
  });

  it('click() lança com rótulo que o envio não tem', async () => {
    const bot = await testBot({ plugins: [escola()] });
    await bot.receive({ text: '!menu' });

    await expect(
      bot.click(bot.sent[0] as NonNullable<(typeof bot.sent)[0]>, 'Faltas'),
    ).rejects.toThrow('botões: ["Notas"]');
  });

  it('sem a capability actions, o menu sai numerado e receive() responde com o número', async () => {
    const transport = new FakeTransport({ capabilities: ['send.text', 'quoted'] });
    const bot = await testBot({ plugins: [escola()], transport });
    await bot.receive({ text: '!menu' });

    expect(bot.sent[0]?.actions).toBeUndefined();
    expect(bot.sent).toContainText('Escolha:\n\n1. Notas');
    await bot.receive({ text: '1' });
    expect(bot.sent).toContainText(`notas de Ana por ${DEFAULT_SENDER.id}`);
  });
});
