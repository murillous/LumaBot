// Aceite do #278 (ADR 0072): um bot atende vários tenants e o mesmo plugin não lê os dados de um
// no outro, sem filtrar nada. O plugin usa o `ctx.storage` do `setup` por closure, como faria
// de verdade, e o service de outro plugin e o job agendado também ficam no tenant da mensagem.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '#message/types.ts';
import { definePlugin } from '#plugin/define.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { pluginStorage } from '#storage/namespace.ts';
import { textMessage } from '#transport/fake-transport.test-support.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';

declare module '@zapforge/core' {
  interface Services {
    'test.contador': { incr(): Promise<number> };
  }
}

const ENGINE = '>=0.0.0';

const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({
    logger: recordingLogger(),
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    env: {},
    ...config,
  });
  bots.push(created);
  return created;
}

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

const CHAT_A: Chat = { id: 'web:a:1', isGroup: false, tenantId: 'escola-a' };
const CHAT_B: Chat = { id: 'web:b:1', isGroup: false, tenantId: 'escola-b' };
const CHAT_SEM: Chat = { id: 'zap@test', isGroup: false };

let nextId = 0;
function say(chat: Chat, text: string) {
  nextId++;
  return textMessage(text, {
    id: `m-${nextId}`,
    chat,
    sender: { id: `${chat.id}:user`, name: null, phone: null },
  });
}

/** Service com estado no storage do próprio plugin, chamado pelo plugin `notas`. */
const contador = definePlugin({
  name: 'contador',
  version: '1.0.0',
  engine: ENGINE,
  setup(ctx) {
    ctx.services.provide('test.contador', {
      async incr() {
        const total = ((await ctx.storage.kv.get<number>('total')) ?? 0) + 1;
        await ctx.storage.kv.set('total', total);
        return total;
      },
    });
  },
});

const notas = definePlugin({
  name: 'notas',
  version: '1.0.0',
  engine: ENGINE,
  dependsOn: { contador: '*' },
  setup(ctx) {
    // Obtida no setup, fora de qualquer tenant: grava no tenant de quem a usa.
    const historico = ctx.storage.collection<{ texto: string }>('historico');
    ctx.commands.add({
      name: 'anota',
      async run(c) {
        const texto = c.args.join(' ');
        await ctx.storage.kv.set('nota', texto);
        await historico.insert({ texto });
        const total = await ctx.services.get('test.contador').incr();
        await ctx.scheduler.at(Date.now(), 'lembra', c.message.chat.id);
        await c.reply(`anotado ${total}`);
      },
    });
    ctx.commands.add({
      name: 'le',
      async run(c) {
        const nota = (await ctx.storage.kv.get<string>('nota')) ?? 'nada';
        const total = (await historico.find()).length;
        await c.reply(`${nota} (${total})`);
      },
    });
    ctx.scheduler.on('lembra', async (chatId) => {
      const nota = (await ctx.storage.kv.get<string>('nota')) ?? 'nada';
      await ctx.send.send(chatId as string, { type: 'text', text: `lembrete: ${nota}` });
    });
    ctx.events.on('reaction', async ({ payload }) => {
      await ctx.storage.kv.set('reacao', payload.emoji ?? '');
    });
  },
});

describe('Bot: isolamento por tenant (#278, ADR 0072)', () => {
  it('dois tenants, o mesmo plugin: nenhuma leitura cruzada', async () => {
    const transport = new RecordingTransport();
    const storage = createMemoryStorage();
    const b = bot({ transport, storage, plugins: [contador, notas] });
    await b.start();

    transport.emit('message', say(CHAT_A, '!anota prova de a'));
    await vi.waitFor(() => expect(sentTexts(transport)).toContain('lembrete: prova de a'));
    transport.emit('message', say(CHAT_B, '!anota prova de b'));
    await vi.waitFor(() => expect(sentTexts(transport)).toContain('lembrete: prova de b'));
    transport.emit('message', say(CHAT_SEM, '!le'));
    transport.emit('message', say(CHAT_A, '!le'));
    transport.emit('message', say(CHAT_B, '!le'));

    await vi.waitFor(() =>
      expect(sentTexts(transport)).toEqual([
        'anotado 1',
        'lembrete: prova de a',
        // O contador do service também é por tenant: o de B começa do zero.
        'anotado 1',
        'lembrete: prova de b',
        'nada (0)',
        'prova de a (1)',
        'prova de b (1)',
      ]),
    );
    // No storage, cada tenant no seu namespace; o da sessão ficou intocado.
    expect(await pluginStorage(storage, 'notas', 'escola-a').kv.get('nota')).toBe('prova de a');
    expect(await pluginStorage(storage, 'contador', 'escola-b').kv.get('total')).toBe(1);
    expect(await pluginStorage(storage, 'notas').kv.get('nota')).toBeUndefined();
  });

  it('evento que não é mensagem também roda no tenant do chat', async () => {
    const transport = new RecordingTransport();
    const storage = createMemoryStorage();
    const b = bot({ transport, storage, plugins: [contador, notas] });
    await b.start();

    transport.emit('reaction', {
      chat: CHAT_A,
      messageId: 'x',
      sender: { id: 'u', name: null, phone: null },
      emoji: '👍',
      fromMe: false,
    });

    await vi.waitFor(async () =>
      expect(await pluginStorage(storage, 'notas', 'escola-a').kv.get('reacao')).toBe('👍'),
    );
    expect(await pluginStorage(storage, 'notas').kv.get('reacao')).toBeUndefined();
  });

  it('forTenant lê um tenant escolhido fora de qualquer handler', async () => {
    const transport = new RecordingTransport();
    const storage = createMemoryStorage();
    await pluginStorage(storage, 'painel', 'escola-a').kv.set('alunos', 30);
    const seen: unknown[] = [];
    const painel = definePlugin({
      name: 'painel',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        seen.push(await ctx.storage.forTenant('escola-a').kv.get('alunos'));
        seen.push(await ctx.storage.kv.get('alunos'));
        expect(() => ctx.storage.forTenant('')).toThrow(TypeError);
      },
    });
    const b = bot({ transport, storage, plugins: [painel] });
    await b.start();

    expect(seen).toEqual([30, undefined]);
  });
});
