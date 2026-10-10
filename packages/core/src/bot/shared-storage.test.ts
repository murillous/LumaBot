// Aceite do #279 (ADR 0075): vários bots no mesmo processo e no mesmo storage, um por transport.
// O `ctx.storage` de cada um fica na sua sessão; só o `ctx.storage.shared`, que o plugin pede, é
// comum a todos, e segue o tenant como o da sessão.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextExpiredError } from '#deadline.ts';
import type { Chat } from '#message/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext } from '#plugin/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { pluginStorage, sessionStorage, sharedStorage } from '#storage/namespace.ts';
import { textMessage } from '#transport/fake-transport.test-support.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';

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

/** Transport de teste com outro `name`, como o do Telegram ou o do web. */
function transportNamed(name: string): RecordingTransport {
  const transport = new RecordingTransport();
  Object.defineProperty(transport, 'name', { value: name });
  return transport;
}

let nextId = 0;
function say(chat: Chat, senderId: string, text: string) {
  nextId++;
  return textMessage(text, {
    id: `m-${nextId}`,
    chat,
    sender: { id: senderId, name: null, phone: null },
  });
}

/**
 * Rank comum às plataformas, com a chave composta pelo transport, e um contador local da sessão.
 * Os dois IDs de remetente são iguais de propósito: em transports diferentes, são pessoas
 * diferentes.
 */
const rank = definePlugin({
  name: 'rank',
  version: '1.0.0',
  engine: ENGINE,
  setup(ctx) {
    ctx.commands.add({
      name: 'ponto',
      async run(c) {
        const key = `${ctx.transportName}:${c.message.sender.id}`;
        const pontos = ((await ctx.storage.shared.kv.get<number>(key)) ?? 0) + 1;
        await ctx.storage.shared.kv.set(key, pontos);
        const local = ((await ctx.storage.kv.get<number>('local')) ?? 0) + 1;
        await ctx.storage.kv.set('local', local);
        await c.reply(`${key}=${pontos} local=${local}`);
      },
    });
    ctx.commands.add({
      name: 'placar',
      async run(c) {
        const zap = await ctx.storage.shared.kv.get<number>('baileys:42');
        const tg = await ctx.storage.shared.kv.get<number>('telegram:42');
        const local = await ctx.storage.kv.get<number>('local');
        await c.reply(`zap=${zap ?? 0} tg=${tg ?? 0} local=${local ?? 0}`);
      },
    });
  },
});

describe('Bot: vários bots num storage com escopo compartilhado (#279, ADR 0075)', () => {
  it('dois bots, um storage: nenhuma leitura cruzada fora do escopo compartilhado', async () => {
    const storage = createMemoryStorage();
    const zap = transportNamed('baileys');
    const tg = transportNamed('telegram');
    const whatsapp = bot({ session: 'whatsapp', transport: zap, storage, plugins: [rank] });
    const telegram = bot({ session: 'telegram', transport: tg, storage, plugins: [rank] });
    await whatsapp.start();
    await telegram.start();
    const chat: Chat = { id: 'c1', isGroup: false };

    zap.emit('message', say(chat, '42', '!ponto'));
    await vi.waitFor(() => expect(sentTexts(zap)).toEqual(['baileys:42=1 local=1']));
    tg.emit('message', say(chat, '42', '!ponto'));
    await vi.waitFor(() => expect(sentTexts(tg)).toEqual(['telegram:42=1 local=1']));
    tg.emit('message', say(chat, '42', '!ponto'));
    await vi.waitFor(() => expect(sentTexts(tg)).toHaveLength(2));
    zap.emit('message', say(chat, '7', '!placar'));
    tg.emit('message', say(chat, '7', '!placar'));

    // O placar compartilhado é o mesmo nos dois bots; o contador local é de cada sessão.
    await vi.waitFor(() => expect(sentTexts(zap)).toContain('zap=1 tg=2 local=1'));
    await vi.waitFor(() => expect(sentTexts(tg)).toContain('zap=1 tg=2 local=2'));
    expect(sentTexts(tg)[1]).toBe('telegram:42=2 local=2');
    const shared = pluginStorage(sharedStorage(storage), 'rank');
    expect(await shared.kv.get('baileys:42')).toBe(1);
    expect(await pluginStorage(sessionStorage(storage, 'whatsapp'), 'rank').kv.get('local')).toBe(
      1,
    );
    // Nenhum bot gravou o rank no escopo da própria sessão.
    expect(
      await pluginStorage(sessionStorage(storage, 'telegram'), 'rank').kv.get('telegram:42'),
    ).toBeUndefined();
  });

  it('o escopo compartilhado segue o tenant do chat, e forTenant escolhe um à mão', async () => {
    const storage = createMemoryStorage();
    const web = transportNamed('web');
    const visto: unknown[] = [];
    const notas = definePlugin({
      name: 'notas',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add({
          name: 'anota',
          async run(c) {
            await ctx.storage.shared.kv.set('nota', c.args.join(' '));
            await c.reply('ok');
          },
        });
        ctx.commands.add({
          name: 'le',
          async run(c) {
            visto.push(await ctx.storage.shared.kv.get('nota'));
            visto.push(await ctx.storage.shared.forTenant('escola-a').kv.get('nota'));
            await c.reply('lido');
          },
        });
      },
    });
    const b = bot({ session: 'web', transport: web, storage, plugins: [notas] });
    await b.start();

    web.emit(
      'message',
      say({ id: 'a:1', isGroup: false, tenantId: 'escola-a' }, 'a:u', '!anota de a'),
    );
    await vi.waitFor(() => expect(sentTexts(web)).toEqual(['ok']));
    web.emit('message', say({ id: 'b:1', isGroup: false, tenantId: 'escola-b' }, 'b:u', '!le'));
    await vi.waitFor(() => expect(sentTexts(web)).toEqual(['ok', 'lido']));

    expect(visto).toEqual([undefined, 'de a']);
    const shared = sharedStorage(storage);
    expect(await pluginStorage(shared, 'notas', 'escola-a').kv.get('nota')).toBe('de a');
    expect(await pluginStorage(shared, 'notas').kv.get('nota')).toBeUndefined();
  });

  it('ctx.transportName é o nome do transport do bot', async () => {
    let captured: PluginContext | undefined;
    const plugin = definePlugin({
      name: 'olho',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        captured = ctx;
      },
    });
    const b = bot({ transport: transportNamed('discord'), plugins: [plugin] });
    await b.start();

    expect(captured?.transportName).toBe('discord');
  });

  it('o escopo compartilhado também rejeita depois do contexto descartado', async () => {
    let captured: PluginContext | undefined;
    const plugin = definePlugin({
      name: 'guardado',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        captured = ctx;
      },
    });
    const b = bot({ transport: new RecordingTransport(), plugins: [plugin] });
    await b.start();
    const ctx = captured as PluginContext;
    await b.stop();

    await expect(ctx.storage.shared.kv.set('x', 1)).rejects.toBeInstanceOf(ContextExpiredError);
    await expect(ctx.storage.shared.forTenant('t').kv.get('x')).rejects.toBeInstanceOf(
      ContextExpiredError,
    );
  });
});
