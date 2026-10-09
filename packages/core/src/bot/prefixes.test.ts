// Prefixo por tipo de chat e por chat, e o `/cmd@bot` do Telegram (ADR 0063, #276).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '#commands/command.ts';
import { ContextExpiredError } from '#deadline.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext, PluginDefinition } from '#plugin/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { kernelStorage } from '#storage/namespace.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { message, RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';

const bots: Bot[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const created of bots.splice(0)) {
    const stopped = created.stop().catch(() => undefined);
    await vi.runAllTimersAsync();
    await stopped;
  }
  vi.useRealTimers();
});

const group = { chatId: 'grupo@test' };

function inGroup(text: string) {
  const base = message(text, group);
  return { ...base, chat: { ...base.chat, isGroup: true, kind: 'group' as const } };
}

/** Plugin com `ajuda`, que responde com o prefixo do chat, e o contexto exposto ao teste. */
function ajuda(onSetup: (ctx: PluginContext) => void = () => undefined): PluginDefinition {
  return definePlugin({
    name: 'ajuda',
    version: '1.0.0',
    engine: '>=0.0.0',
    setup(ctx) {
      onSetup(ctx);
      ctx.commands.add(
        command({
          name: 'ajuda',
          run: (c) => c.reply(`use ${ctx.prefixes.get(c.message.chat)}ajuda`),
        }),
      );
    },
  });
}

async function startBot(
  transport: RecordingTransport,
  plugins: PluginDefinition[],
  extra: Partial<BotConfig> = {},
): Promise<Bot> {
  const bot = createBot({
    transport,
    logger: recordingLogger(),
    env: {},
    plugins,
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...extra,
  });
  bots.push(bot);
  await bot.start();
  return bot;
}

describe('Bot: prefixo por tipo de chat e por chat (ADR 0063)', () => {
  it('um padrão por tipo: sem prefixo na conversa individual, `!` no grupo', async () => {
    const transport = new RecordingTransport();
    const bot = await startBot(transport, [ajuda()], { prefix: { dm: '' } });

    for (const sent of [message('ajuda'), inGroup('ajuda'), inGroup('!ajuda')]) {
      transport.emit('message', sent);
      await bot.settled();
    }

    expect(sentTexts(transport)).toEqual(['use ajuda', 'use !ajuda']);
  });

  it('o override de um chat vale na hora, só nele, e o reset volta ao padrão', async () => {
    const transport = new RecordingTransport();
    let ctx: PluginContext | undefined;
    const bot = await startBot(transport, [
      ajuda((c) => {
        ctx = c;
      }),
    ]);

    await ctx?.prefixes.set(group.chatId, '/');
    // Um `settled` por mensagem: chats diferentes não garantem a ordem de envio entre si.
    for (const sent of [inGroup('!ajuda'), inGroup('/ajuda'), message('!ajuda')]) {
      transport.emit('message', sent);
      await bot.settled();
    }
    expect(await ctx?.prefixes.reset(group.chatId)).toBe(true);
    expect(await ctx?.prefixes.reset(group.chatId)).toBe(false);
    transport.emit('message', inGroup('!ajuda'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['use /ajuda', 'use !ajuda', 'use !ajuda']);
  });

  it('o override fica no storage e é carregado no boot, antes do setup', async () => {
    const storage = createMemoryStorage();
    await kernelStorage(storage, 'prefixes')
      .collection('chats')
      .insert({ chat: group.chatId, prefix: '.' });
    const transport = new RecordingTransport();
    let seenInSetup: string | undefined;
    const bot = await startBot(
      transport,
      [
        ajuda((c) => {
          seenInSetup = c.prefixes.get({ id: group.chatId, isGroup: true });
        }),
      ],
      { storage },
    );

    transport.emit('message', inGroup('.ajuda'));
    await bot.settled();

    expect(seenInSetup).toBe('.');
    expect(sentTexts(transport)).toEqual(['use .ajuda']);
  });

  it('set grava no storage, e uma troca seguida substitui a anterior', async () => {
    const storage = createMemoryStorage();
    let ctx: PluginContext | undefined;
    await startBot(
      new RecordingTransport(),
      [
        ajuda((c) => {
          ctx = c;
        }),
      ],
      { storage },
    );

    await Promise.all([ctx?.prefixes.set('a', '/'), ctx?.prefixes.set('a', '#')]);
    const stored = await kernelStorage(storage, 'prefixes').collection('chats').find();

    expect(stored.map(({ chat, prefix }) => ({ chat, prefix }))).toEqual([
      { chat: 'a', prefix: '#' },
    ]);
  });

  it('prefixo inválido lança TypeError, na config e no set', async () => {
    const transport = new RecordingTransport();
    expect(() => createBot({ transport, prefix: { group: ' !' } })).toThrow(TypeError);

    let ctx: PluginContext | undefined;
    await startBot(transport, [
      ajuda((c) => {
        ctx = c;
      }),
    ]);
    expect(() => ctx?.prefixes.set('a', '\n!')).toThrow(TypeError);
  });

  it('contexto descartado: set e reset rejeitam com ContextExpiredError', async () => {
    let ctx: PluginContext | undefined;
    const bot = await startBot(new RecordingTransport(), [
      ajuda((c) => {
        ctx = c;
      }),
    ]);
    const stopped = bot.stop();
    await vi.runAllTimersAsync();
    await stopped;

    await expect(ctx?.prefixes.set('a', '/')).rejects.toBeInstanceOf(ContextExpiredError);
    await expect(ctx?.prefixes.reset('a')).rejects.toBeInstanceOf(ContextExpiredError);
  });

  it('`/ajuda@MeuBot` de um grupo do Telegram roda o comando; `@OutroBot`, não', async () => {
    class TelegramTransport extends RecordingTransport {
      override readonly self = { id: 'bot@test', name: 'Bot', phone: null, username: 'MeuBot' };
    }
    const transport = new TelegramTransport();
    const heard: string[] = [];
    const listener = definePlugin({
      name: 'ouvinte',
      version: '1.0.0',
      engine: '>=0.0.0',
      setup(ctx) {
        ctx.events.on('message', (c) => {
          heard.push(c.message.text ?? '');
        });
      },
    });
    const bot = await startBot(transport, [ajuda(), listener], { prefix: '/' });

    transport.emit('message', inGroup('/ajuda@MeuBot'));
    transport.emit('message', inGroup('/ajuda@OutroBot'));
    await bot.settled();

    expect(sentTexts(transport)).toEqual(['use /ajuda']);
    expect(heard).toEqual(['/ajuda@OutroBot']);
  });
});
