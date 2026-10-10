// Aceite do #287 do lado do Baileys (ADR 0055, 0077): o mesmo plugin que roda no transport-web
// (ver `transport-web/src/bot.test.ts`) roda aqui sem mudança. Sem `actions`, o menu vira texto
// numerado, e a resposta com o número roda o comando do botão (ADR 0062).

import {
  type Bot,
  command,
  createBot,
  createLogger,
  createMemoryStorage,
  definePlugin,
} from '@zapforge/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDriver } from './fake-socket.test-support.ts';
import { BaileysTransport } from './transport.ts';

const CHAT = '5511999990000@s.whatsapp.net';
const bots: Bot[] = [];

afterEach(async () => {
  for (const bot of bots.splice(0)) await bot.stop();
});

const portable = definePlugin({
  name: 'portatil',
  version: '1.0.0',
  engine: '>=0.0.0',
  setup(ctx) {
    ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
    ctx.commands.add(
      command({
        name: 'menu',
        run: (c) =>
          c.reply('Escolha:', {
            actions: [
              { label: 'Ping', command: 'ping' },
              { label: 'Eco', command: 'eco', args: ['clicado'] },
            ],
          }),
      }),
    );
    ctx.commands.add(command({ name: 'eco', run: (c) => c.reply(`eco ${c.rawArgs}`) }));
  },
});

describe('plugin portátil no Baileys', () => {
  it('!ping responde e o menu com botões vira texto numerado que roda o comando', async () => {
    const driver = new FakeDriver();
    const bot = createBot({
      transport: (deps) => new BaileysTransport({ pairing: 'qr', driver }, deps),
      storage: createMemoryStorage(),
      logger: createLogger({ level: 'silent' }),
      outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
      env: {},
      prefix: '!',
      plugins: [portable],
    });
    bots.push(bot);
    await bot.start();
    driver.last.emit('connection.update', { connection: 'open' });

    let seq = 0;
    const receive = (text: string) =>
      driver.last.emit('messages.upsert', {
        type: 'notify',
        messages: [
          {
            key: { remoteJid: CHAT, id: `M${++seq}`, fromMe: false },
            message: { conversation: text },
            messageTimestamp: 1_760_000_000 + seq,
          },
        ],
      });
    const texts = () => driver.last.sent.map((s) => (s.content as { text?: string }).text ?? '');

    receive('!ping');
    await vi.waitFor(() => expect(texts()).toEqual(['pong']));

    receive('!menu');
    await vi.waitFor(() => expect(texts()).toHaveLength(2));
    expect(texts()[1]).toBe('Escolha:\n\n1. Ping\n2. Eco');

    receive('2');
    await vi.waitFor(() => expect(texts().at(-1)).toBe('eco clicado'));
  });
});
