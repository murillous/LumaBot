// Papéis custom nomeados (M1-19, ADR 0035): um plugin define, outro exige, o roteador avalia com
// prazo e fail-closed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { command } from '#commands/command.ts';
import { RoleConflictError, type RoleContext, RoleTimeoutError } from '#commands/roles.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { definePlugin } from '#plugin/define.ts';
import { PluginHostStateError } from '#plugin/host.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import {
  deferred,
  message,
  RecordingTransport,
  recordingLogger,
  sentTexts,
} from './harness.test-support.ts';

declare module '@zapforge/core' {
  interface Roles {
    moderador: true;
    'test.outro': true;
  }
}

const ENGINE = '>=0.0.0';
const OWNER = '5511999999999';
const bots: Bot[] = [];

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

function bot(config: Partial<BotConfig> & Pick<BotConfig, 'transport'>): Bot {
  const created = createBot({
    env: {},
    logger: recordingLogger(),
    owners: [OWNER],
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    ...config,
  });
  bots.push(created);
  return created;
}

/** Plugin dono do papel `moderador`; `check` decide quem passa. */
function moderacao(check: (ctx: RoleContext) => boolean | Promise<boolean>) {
  return definePlugin({
    name: 'moderacao',
    version: '1.0.0',
    engine: ENGINE,
    setup: (ctx) => ctx.roles.define('moderador', check),
  });
}

/** Plugin que exige o papel de outro: `!ban` só para moderador, `!ping` livre. */
function banimento(errors: PluginErrorEvent[] = []) {
  return definePlugin({
    name: 'banimento',
    version: '1.0.0',
    engine: ENGINE,
    dependsOn: { moderacao: '^1.0.0' },
    setup(ctx) {
      ctx.commands.add(
        command({
          name: 'ban',
          role: 'moderador',
          onReject: () => 'só moderador',
          run: (c) => c.reply('banido'),
        }),
      );
      ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
      ctx.events.on('plugin.error', (e) => {
        errors.push(e.payload);
      });
    },
  });
}

const from = (id: string, phone: string | null = null) => ({ sender: { id, phone } });

describe('papéis custom nomeados', () => {
  it('concede e nega pelo check do plugin dono; owner passa sem consultar', async () => {
    const transport = new RecordingTransport();
    const seen: RoleContext[] = [];
    const check = vi.fn((ctx: RoleContext) => {
      seen.push(ctx);
      return ctx.message.sender.id === 'mod@test';
    });
    const b = bot({ transport, plugins: [moderacao(check), banimento()] });
    await b.start();

    transport.emit('message', message('!ban', from('mod@test')));
    transport.emit('message', message('!ban', from('outro@test')));
    transport.emit('message', message('!ban', from('dono@lid', OWNER)));

    await vi.waitFor(() =>
      expect(sentTexts(transport)).toEqual(['banido', 'só moderador', 'banido']),
    );
    expect(check).toHaveBeenCalledTimes(2);
    expect(seen[0]).toMatchObject({ command: 'ban', text: '!ban' });
    expect(seen[0]?.signal.aborted).toBe(false);
  });

  it('só true concede: valor truthy que não é true recusa', async () => {
    const transport = new RecordingTransport();
    const truthy = moderacao(() => 'sim' as unknown as boolean);
    const b = bot({ transport, plugins: [truthy, banimento()] });
    await b.start();

    transport.emit('message', message('!ban'));

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['só moderador']));
  });

  it.each([
    [
      'lança',
      () => {
        throw new Error('boom');
      },
    ],
    ['rejeita', () => Promise.reject(new Error('boom'))],
  ])('check que %s recusa e vira plugin.error do dono do papel', async (_, check) => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    const b = bot({ transport, plugins: [moderacao(check), banimento(errors)] });
    await b.start();

    transport.emit('message', message('!ban'));

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['só moderador']));
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({
      plugin: 'moderacao',
      phase: 'role',
      event: 'moderador',
      timedOut: false,
    });
    expect(errors[0]?.error).toMatchObject({ message: 'boom' });
  });

  it('check preso estoura o prazo: recusa, aborta o signal e libera o chat', async () => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    let signal: AbortSignal | undefined;
    const preso = moderacao((ctx) => {
      signal = ctx.signal;
      return new Promise<boolean>(() => undefined);
    });
    const b = bot({
      transport,
      plugins: [preso, banimento(errors)],
      timeouts: { commandMs: 20 },
    });
    await b.start();

    transport.emit('message', message('!ban'));
    transport.emit('message', message('!ping')); // mesmo chat: espera o !ban

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['só moderador', 'pong']));
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({ plugin: 'moderacao', phase: 'role', timedOut: true });
    expect(errors[0]?.error).toBeInstanceOf(RoleTimeoutError);
    expect(errors[0]?.error).toMatchObject({ plugin: 'moderacao', role: 'moderador' });
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe(errors[0]?.error);
  });

  it('papel que nenhum plugin define recusa e loga erro citando dependsOn', async () => {
    const transport = new RecordingTransport();
    const logger = recordingLogger();
    const ran = vi.fn();
    const sozinho = definePlugin({
      name: 'sozinho',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) =>
        ctx.commands.add(
          command({ name: 'ban', role: 'moderador', onReject: () => 'recusado', run: ran }),
        ),
    });
    const b = bot({ transport, logger, plugins: [sozinho] });
    await b.start();

    transport.emit('message', message('!ban'));

    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['recusado']));
    expect(ran).not.toHaveBeenCalled();
    const line = logger.lines.find((entry) => entry.fields['role'] === 'moderador');
    expect(line?.level).toBe('error');
    expect(line?.message).toContain('dependsOn');
    expect(line?.fields).toMatchObject({ plugin: 'sozinho', command: 'ban' });
  });

  it('nome reservado falha no setup e o plugin fica ignorado', async () => {
    const transport = new RecordingTransport();
    const errors: PluginErrorEvent[] = [];
    const observador = definePlugin({
      name: 'observador',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) => {
        ctx.events.on('plugin.error', (e) => {
          errors.push(e.payload);
        });
      },
    });
    const reservado = definePlugin({
      name: 'reservado',
      version: '1.0.0',
      engine: ENGINE,
      setup: (ctx) =>
        (ctx.roles.define as (name: string, check: () => boolean) => void)('owner', () => true),
    });
    const b = bot({
      transport,
      plugins: [observador, moderacao(() => false), reservado],
    });
    await b.start();

    const status = Object.fromEntries(b.plugins().map((entry) => [entry.name, entry.status]));
    expect(status).toMatchObject({ moderacao: 'loaded', reservado: 'skipped' });
    const byPlugin = Object.fromEntries(errors.map((e) => [e.plugin, e.error]));
    expect(byPlugin['reservado']).toBeInstanceOf(TypeError);
  });

  it('conflito de papel entre plugins derruba o boot (ADR 0035)', async () => {
    const transport = new RecordingTransport();
    const rival = definePlugin({
      name: 'rival',
      version: '1.0.0',
      engine: ENGINE,
      dependsOn: { moderacao: '^1.0.0' },
      setup: (ctx) => ctx.roles.define('moderador', () => true),
    });
    const b = bot({ transport, plugins: [moderacao(() => false), rival] });

    const error = await b.start().then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(RoleConflictError);
    expect(error).toMatchObject({ role: 'moderador', existing: 'moderacao', incoming: 'rival' });
    expect(b.state).toBe('stopped');
  });

  it('reload do dono remove e recria o papel', async () => {
    const transport = new RecordingTransport();
    const versionado = definePlugin({
      name: 'moderacao',
      version: '1.0.0',
      engine: ENGINE,
      config: z.object({ libera: z.boolean().default(false) }),
      setup(ctx) {
        // Sem tirar o papel no dispose, o setup novo falharia com RoleConflictError; e o papel
        // tem de ser o da instância nova, que concede.
        const { libera } = ctx.config;
        ctx.roles.define('moderador', () => libera);
      },
    });
    const b = bot({ transport, plugins: [versionado, banimento()] });
    await b.start();

    transport.emit('message', message('!ban'));
    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['só moderador']));

    const result = await b.config.setOverrides('moderacao', { libera: true });
    expect(result?.entry.status).toBe('loaded');
    transport.emit('message', message('!ban'));
    await vi.waitFor(() => expect(sentTexts(transport)).toEqual(['só moderador', 'banido']));
  });

  it('roles.define depois do descarte lança PluginHostStateError', async () => {
    const transport = new RecordingTransport();
    const gate = deferred();
    let late: unknown;
    const lento = definePlugin({
      name: 'lento',
      version: '1.0.0',
      engine: ENGINE,
      async setup(ctx) {
        await gate.promise;
        try {
          ctx.roles.define('test.outro', () => true);
        } catch (error) {
          late = error;
        }
      },
    });
    const b = bot({ transport, plugins: [lento], timeouts: { setupMs: 10 } });
    await b.start();
    gate.resolve();

    await vi.waitFor(() => expect(late).toBeInstanceOf(PluginHostStateError));
  });
});
