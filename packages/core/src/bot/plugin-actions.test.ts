// #224 (ADR 0040): o plugin reage, edita, apaga, mostra presença, lê e altera grupos, lista
// comandos, vê o contato da sessão e as capabilities, e ouve `contact.updated`, tudo pela API
// pública, sem `ctx.unsafe.native`.

import { afterEach, describe, expect, it } from 'vitest';
import { command } from '#commands/command.ts';
import { ContextExpiredError } from '#deadline.ts';
import type { Contact } from '#message/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginContext } from '#plugin/types.ts';
import { type Capability, UnsupportedError } from '#transport/capabilities.ts';
import type {
  GroupMetadata,
  GroupParticipantAction,
  MessageKey,
  Presence,
} from '#transport/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { deferred, message, RecordingTransport, recordingLogger } from './harness.test-support.ts';

const ENGINE = '>=0.0.0';

const ALL: Capability[] = [
  'send.text',
  'quoted',
  'reactions',
  'message.edit',
  'message.delete',
  'presence',
  'groups',
  'groups.admin',
];

/** Transport que registra cada ação, na ordem em que chega a ele. */
class ActionTransport extends RecordingTransport {
  readonly actions: unknown[][] = [];

  override async react(key: MessageKey, emoji: string | null): Promise<void> {
    await super.react(key, emoji);
    this.actions.push(['react', key.id, emoji]);
  }

  override async edit(key: MessageKey, text: string): Promise<void> {
    await super.edit(key, text);
    this.actions.push(['edit', key.id, text]);
  }

  override async delete(key: MessageKey): Promise<void> {
    await super.delete(key);
    this.actions.push(['delete', key.id]);
  }

  override async sendPresence(chatId: string, presence: Presence): Promise<void> {
    await super.sendPresence(chatId, presence);
    this.actions.push(['presence', chatId, presence]);
  }

  override async updateGroupParticipants(
    groupId: string,
    participantIds: readonly string[],
    action: GroupParticipantAction,
  ): Promise<void> {
    await super.updateGroupParticipants(groupId, participantIds, action);
    this.actions.push(['participants', groupId, [...participantIds], action]);
  }
}

const bots: Bot[] = [];

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({
    logger: recordingLogger(),
    env: {},
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...config,
  });
  bots.push(created);
  return created;
}

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

/** Sobe um bot com um plugin que entrega o contexto. */
async function withContext(
  transport: RecordingTransport,
  extra: Partial<BotConfig> = {},
): Promise<{ ctx: PluginContext; bot: Bot }> {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name: 'sonda',
    version: '1.0.0',
    engine: ENGINE,
    setup(ctx) {
      captured = ctx as PluginContext;
    },
  });
  const b = bot({ transport, ...extra, plugins: [plugin, ...(extra.plugins ?? [])] });
  await b.start();
  if (captured === undefined) throw new Error('setup não rodou');
  return { ctx: captured, bot: b };
}

describe('ctx.send: ações pela fila de saída', () => {
  it('react, edit, delete e presence chegam ao transport', async () => {
    const transport = new ActionTransport(ALL);
    const { ctx } = await withContext(transport);
    const key = await ctx.send.send('chat@test', { type: 'text', text: 'pensando…' });
    await ctx.send.presence('chat@test', 'composing');
    await ctx.send.edit(key, 'pronto');
    await ctx.send.react(key, '✅');
    await ctx.send.delete(key);
    expect(transport.actions).toEqual([
      ['presence', 'chat@test', 'composing'],
      ['edit', key.id, 'pronto'],
      ['react', key.id, '✅'],
      ['delete', key.id],
    ]);
    expect(transport.sent).toHaveLength(1);
  });

  it('sem a capability, rejeita com UnsupportedError', async () => {
    const transport = new ActionTransport(['send.text']);
    const { ctx } = await withContext(transport);
    const key: MessageKey = { chatId: 'c', id: 'x', fromMe: false, senderId: null };
    await expect(ctx.send.react(key, '👍')).rejects.toBeInstanceOf(UnsupportedError);
    await expect(ctx.groups.metadata('g@test')).rejects.toMatchObject({ capability: 'groups' });
    await expect(ctx.groups.updateParticipants('g@test', ['a'], 'remove')).rejects.toMatchObject({
      capability: 'groups.admin',
    });
    expect(transport.actions).toEqual([]);
  });

  it('contexto descartado recusa as ações e os grupos com ContextExpiredError', async () => {
    const transport = new ActionTransport(ALL);
    const { ctx, bot: b } = await withContext(transport);
    await b.stop();
    const key: MessageKey = { chatId: 'c', id: 'x', fromMe: false, senderId: null };
    for (const attempt of [
      ctx.send.react(key, '👍'),
      ctx.send.edit(key, 'x'),
      ctx.send.delete(key),
      ctx.send.presence('c', 'paused'),
      ctx.groups.metadata('g@test'),
      ctx.groups.updateParticipants('g@test', ['a'], 'add'),
    ]) {
      await expect(attempt).rejects.toBeInstanceOf(ContextExpiredError);
    }
    expect(transport.actions).toEqual([]);
  });
});

describe('ctx.groups', () => {
  it('metadata lê do transport; updateParticipants passa pela fila', async () => {
    const transport = new ActionTransport(ALL);
    const { ctx } = await withContext(transport);
    const metadata: GroupMetadata = await ctx.groups.metadata('g@test');
    expect(metadata.participants.map((p) => p.id)).toEqual([transport.admin.id, 'member@test']);
    await ctx.groups.updateParticipants('g@test', ['member@test'], 'remove');
    expect(transport.actions).toEqual([['participants', 'g@test', ['member@test'], 'remove']]);
  });
});

describe('leituras no contexto', () => {
  it('commands.list traz os comandos de todos os plugins, sem o run', async () => {
    const transport = new ActionTransport(ALL);
    const outro = definePlugin({
      name: 'outro',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'ban',
            aliases: ['kick'],
            description: 'Remove do grupo',
            role: 'group-admin',
            run: () => undefined,
          }),
        );
        ctx.commands.add({ name: 'ping', run: () => undefined });
      },
    });
    const { ctx } = await withContext(transport, { plugins: [outro] });
    expect(ctx.commands.list()).toEqual([
      {
        plugin: 'outro',
        name: 'ban',
        aliases: ['kick'],
        description: 'Remove do grupo',
        role: 'group-admin',
      },
      { plugin: 'outro', name: 'ping', aliases: [], description: null, role: 'everyone' },
    ]);
  });

  it('self é o contato da sessão; capabilities é uma cópia só de leitura', async () => {
    const transport = new ActionTransport(['send.text', 'reactions']);
    const { ctx } = await withContext(transport);
    const self: Contact | null = ctx.self;
    expect(self).toEqual(transport.self);
    expect(ctx.capabilities.has('reactions')).toBe(true);
    expect(ctx.capabilities.has('groups')).toBe(false);
    (ctx.capabilities as Set<Capability>).add('groups');
    expect(transport.capabilities.has('groups')).toBe(false);
  });
});

describe('atalho react no contexto de mensagem', () => {
  it('comando e listener reagem à mensagem recebida, pela chave dela', async () => {
    const transport = new ActionTransport(ALL);
    const plugin = definePlugin({
      name: 'reator',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(command({ name: 'ok', run: (c) => c.react('👍') }));
        ctx.events.on('message', (e) => (e.text === 'oi' ? e.react('👋') : undefined));
      },
    });
    const b = bot({ transport, plugins: [plugin] });
    await b.start();
    const cmd = message('!ok');
    const hi = message('oi');
    transport.emit('message', cmd);
    transport.emit('message', hi);
    await expect.poll(() => transport.actions).toHaveLength(2);
    expect(transport.actions).toEqual([
      ['react', cmd.id, '👍'],
      ['react', hi.id, '👋'],
    ]);
  });

  it('react depois do prazo do comando é recusado com ContextExpiredError', async () => {
    const transport = new ActionTransport(ALL);
    const gate = deferred();
    let late: Promise<void> | undefined;
    const plugin = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'lento',
            run: async (c) => {
              const react = c.react;
              await gate.promise;
              late = react('⏰');
              await late.catch(() => undefined);
            },
          }),
        );
      },
    });
    const b = bot({ transport, plugins: [plugin], timeouts: { commandMs: 20 } });
    await b.start();
    transport.emit('message', message('!lento'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    gate.resolve();
    await expect.poll(() => late !== undefined).toBe(true);
    await expect(late).rejects.toBeInstanceOf(ContextExpiredError);
    expect(transport.actions).toEqual([]);
  });
});

describe('evento contact.updated', () => {
  it('chega aos listeners mesmo com chatFilter, só com os campos alterados', async () => {
    const transport = new ActionTransport(ALL);
    const seen: unknown[] = [];
    const plugin = definePlugin({
      name: 'nomes',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('contact.updated', (e) => void seen.push(e.payload));
      },
    });
    const b = bot({
      transport,
      plugins: [plugin],
      middlewares: { chatFilter: { allow: ['outro@test'] } },
    });
    await b.start();
    transport.emit('contact.updated', { id: 'ana@test', name: 'Ana' });
    await expect.poll(() => seen).toEqual([{ id: 'ana@test', name: 'Ana' }]);
  });
});
