// M1-12 (#198): a fila de saída e o estado da conexão, com relógio falso.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sender } from '#outbound/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { MessageKey, OutgoingContent, SendOptions } from '#transport/types.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { RecordingTransport, recordingLogger, sentTexts } from './harness.test-support.ts';

/** Transport cujo `send` rejeita como o Baileys enquanto a conexão está fechada. */
class DroppingTransport extends RecordingTransport {
  drop(): void {
    this.connected = false;
    this.emit('connection.status', { status: 'closed', reason: 'connection-lost', error: null });
  }

  override async send(
    chatId: string,
    content: OutgoingContent,
    options?: SendOptions,
  ): Promise<MessageKey> {
    if (!this.connected) throw new Error('Connection Closed');
    return super.send(chatId, content, options);
  }
}

const bots: Bot[] = [];

/** Bot com um plugin que entrega o `ctx.send` ao teste. */
async function startBot(
  transport: RecordingTransport,
  config: Partial<BotConfig> = {},
): Promise<{ bot: Bot; send: Sender }> {
  let send: Sender | undefined;
  const plugin = definePlugin({
    name: 'avisos',
    version: '1.0.0',
    engine: '>=0.0.0',
    setup(ctx) {
      send = ctx.send;
    },
  });
  const bot = createBot({
    logger: recordingLogger(),
    env: {},
    transport,
    plugins: [plugin],
    ...config,
  });
  bots.push(bot);
  await bot.start();
  if (send === undefined) throw new Error('setup não rodou');
  return { bot, send };
}

const text = (t: string): OutgoingContent => ({ type: 'text', text: t });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
  vi.useRealTimers();
});

describe('Bot: fila de saída durante a queda de conexão', () => {
  it('envio aceito durante a queda espera a reconexão em vez de esgotar o retry', async () => {
    const transport = new DroppingTransport();
    const { send } = await startBot(transport);

    transport.drop();
    const result = send.send('c@test', text('oi'));
    const settled = vi.fn();
    result.then(settled, settled);

    // Padrões: retry desiste em ~3 s; a primeira reconexão sai em 5 s.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ chatId: 'c@test' });
    expect(sentTexts(transport)).toEqual(['oi']);
  });

  it('conexão caída além de outbound.maxPauseMs: rejeita com disconnected', async () => {
    const transport = new DroppingTransport();
    const { send } = await startBot(transport, {
      outbound: { maxPauseMs: 2000 },
      reconnection: { backoff: () => 10_000 },
    });

    transport.drop();
    const result = send.send('c@test', text('oi'));
    result.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).rejects.toMatchObject({ reason: 'disconnected' });

    // Reconectada, volta a aceitar.
    await vi.advanceTimersByTimeAsync(8000);
    await expect(send.send('c@test', text('de volta'))).resolves.toBeDefined();
    expect(sentTexts(transport)).toEqual(['de volta']);
  });

  it('stop() com a conexão caída descarta o que aguarda sem gastar o prazo da fila', async () => {
    const transport = new DroppingTransport();
    const { bot, send } = await startBot(transport);

    transport.drop();
    const result = send.send('c@test', text('oi'));
    result.catch(() => undefined);
    const stopped = vi.fn();
    void bot.stop().then(stopped);
    await vi.advanceTimersByTimeAsync(0);

    expect(stopped).toHaveBeenCalled();
    await expect(result).rejects.toMatchObject({ reason: 'closed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("'replaced' para o bot e descarta o que aguarda, sem reenviar pela outra conexão", async () => {
    const transport = new DroppingTransport();
    const { bot, send } = await startBot(transport);

    transport.connected = false;
    transport.emit('connection.status', { status: 'closed', reason: 'replaced', error: null });
    const result = send.send('c@test', text('oi'));
    result.catch(() => undefined);
    await vi.waitFor(() => expect(bot.state).toBe('stopped'));

    await expect(result).rejects.toMatchObject({ reason: 'closed' });
    expect(sentTexts(transport)).toEqual([]);
  });
});

/** `connect()` que resolve ao iniciar a tentativa, como o do Baileys: o `open` vem depois. */
class LateOpenTransport extends DroppingTransport {
  override async connect(): Promise<void> {
    this.calls.push('connect');
    this.emit('connection.status', { status: 'connecting' });
  }

  open(): void {
    this.connected = true;
    this.emit('connection.status', { status: 'open' });
  }
}

/** Bot cujo plugin envia no `setup`, antes do `connect()`. */
async function startBotSendingOnSetup(
  transport: RecordingTransport,
): Promise<{ bot: Bot; sent: Promise<MessageKey> }> {
  let sent: Promise<MessageKey> | undefined;
  const plugin = definePlugin({
    name: 'boas-vindas',
    version: '1.0.0',
    engine: '>=0.0.0',
    setup(ctx) {
      sent = ctx.send.send('c@test', text('online'));
      sent.catch(() => undefined);
    },
  });
  const bot = createBot({ logger: recordingLogger(), env: {}, transport, plugins: [plugin] });
  bots.push(bot);
  await bot.start();
  if (sent === undefined) throw new Error('setup não rodou');
  return { bot, sent };
}

// #253 (ADR 0048): a fila nasce pausada e só despacha no primeiro `open`.
describe('Bot: fila de saída até o primeiro open', () => {
  it('envio do setup espera o open em vez de ir para o socket fechado', async () => {
    const transport = new LateOpenTransport();
    const { bot, sent } = await startBotSendingOnSetup(transport);
    expect(bot.state).toBe('running');
    expect(bot.stats().outbound.paused).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sentTexts(transport)).toEqual([]);

    transport.open();
    await expect(sent).resolves.toBeDefined();
    expect(sentTexts(transport)).toEqual(['online']);
  });

  it('o teto da pausa conta desde o start(): sem open, rejeita com disconnected', async () => {
    const transport = new LateOpenTransport();
    const { sent } = await startBotSendingOnSetup(transport);

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(sent).rejects.toMatchObject({ reason: 'disconnected' });
    expect(sentTexts(transport)).toEqual([]);
  });
});
