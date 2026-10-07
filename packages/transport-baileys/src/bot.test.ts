// O transport dentro do `Bot`: o kernel executa a política de reconexão em cima dos motivos que
// o adapter dá (ADR 0045/0048) e roteia as mensagens que ele normaliza.

import {
  type Bot,
  type BotConfig,
  command,
  createBot,
  createLogger,
  createMemoryStorage,
  definePlugin,
} from '@zapforge/core';
import { DisconnectReason } from 'baileys';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boom, FakeDriver } from './fake-socket.test-support.ts';
import { BaileysTransport } from './transport.ts';

const bots: Bot[] = [];

afterEach(async () => {
  for (const bot of bots.splice(0)) await bot.stop();
});

function start(config: Partial<BotConfig> = {}) {
  const driver = new FakeDriver();
  const storage = createMemoryStorage();
  const bot = createBot({
    transport: (deps) => new BaileysTransport({ pairing: 'qr', driver }, deps),
    storage,
    logger: createLogger({ level: 'silent' }),
    env: {},
    reconnection: { backoff: () => 0, cleanDelayMs: 0, minCleanIntervalMs: 0 },
    ...config,
  });
  bots.push(bot);
  return { driver, bot, auth: storage.authState('default') };
}

describe('BaileysTransport no Bot', () => {
  it('restart pedido depois do pareamento (515) reconecta com as credenciais novas', async () => {
    const { driver, bot } = start();
    await bot.start();
    driver.last.emit('connection.update', { qr: 'QR-1' });
    driver.last.updateCreds({ registered: true });
    driver.last.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boom(DisconnectReason.restartRequired), date: new Date() },
    });

    await vi.waitFor(() => expect(driver.sockets).toHaveLength(2));
    expect(driver.last.config.auth.creds.registered).toBe(true);
  });

  it('logout no aparelho limpa a sessão e volta a parear do zero', async () => {
    const { driver, bot, auth } = start();
    await bot.start();
    driver.last.updateCreds({ registered: true });
    await vi.waitFor(async () => expect(await auth.getCreds()).toBeDefined());
    driver.last.emit('connection.update', { connection: 'open' });
    driver.last.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boom(DisconnectReason.loggedOut), date: new Date() },
    });

    await vi.waitFor(() => expect(driver.sockets).toHaveLength(2));
    expect(await auth.getCreds()).toBeUndefined();
    expect(driver.last.config.auth.creds.registered).toBe(false);
  });

  it('queda de rede reconecta sem apagar as credenciais (ADR 0045)', async () => {
    const { driver, bot, auth } = start();
    await bot.start();
    driver.last.updateCreds({ registered: true });
    await vi.waitFor(async () => expect(await auth.getCreds()).toBeDefined());
    driver.last.emit('connection.update', { connection: 'open' });
    driver.last.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boom(DisconnectReason.connectionLost), date: new Date() },
    });

    await vi.waitFor(() => expect(driver.sockets).toHaveLength(2));
    expect(driver.last.config.auth.creds.registered).toBe(true);
  });

  it('conexão substituída para o bot sem reconectar', async () => {
    const { driver, bot } = start();
    await bot.start();
    driver.last.emit('connection.update', { connection: 'open' });
    driver.last.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boom(DisconnectReason.connectionReplaced), date: new Date() },
    });

    await vi.waitFor(() => expect(bot.state).toBe('stopped'));
    expect(driver.sockets).toHaveLength(1);
  });

  it('owner com LID no grupo é reconhecido pelo telefone resolvido (M1-16.4)', async () => {
    const ran: string[] = [];
    const admin = definePlugin({
      name: 'admin',
      version: '1.0.0',
      engine: '>=0.0.0',
      setup: (ctx) => {
        ctx.commands.add(
          command({
            name: 'ban',
            role: 'owner',
            run: (c) => {
              ran.push(c.message.sender.id);
            },
          }),
        );
      },
    });
    const { driver, bot } = start({ prefix: '!', owners: ['5511911110000'], plugins: [admin] });
    await bot.start();
    driver.last.emit('connection.update', { connection: 'open' });
    driver.last.lids.set('111@lid', '5511911110000@s.whatsapp.net');

    const fromLid = (id: string, participant: string) => ({
      key: { remoteJid: '120363000000000001@g.us', id, fromMe: false, participant },
      message: { ephemeralMessage: { message: { conversation: '!ban' } } },
      messageTimestamp: 1_760_000_000,
    });
    driver.last.emit('messages.upsert', {
      type: 'notify',
      // O sem par vem antes: a fila do chat é serial, então quando o owner roda o outro já foi
      // recusado.
      messages: [fromLid('M1', '222@lid'), fromLid('M2', '111@lid')],
    });

    await vi.waitFor(() => expect(ran).toEqual(['111@lid']));
  });
});
