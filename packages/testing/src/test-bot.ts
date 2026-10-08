import { type Bot, type BotConfig, createBot, createLogger, type Message } from '@zapforge/core';
import type { TransportEvents } from '@zapforge/core/adapter';
import { FakeTransport, type SentMessage } from './fake-transport.ts';
import { buildMessage, type IncomingMessage } from './incoming.ts';

export interface TestBotOptions extends Omit<BotConfig, 'transport'> {
  /** Padrão: um `FakeTransport` com todas as capabilities. */
  readonly transport?: FakeTransport;
}

/** Bot rodando sobre um `FakeTransport`; cada ação espera o bot assentar antes de resolver. */
export interface TestBot {
  readonly bot: Bot;
  readonly transport: FakeTransport;
  /** O que o bot enviou, na ordem (o mesmo array de `transport.sent`). */
  readonly sent: readonly SentMessage[];
  /**
   * Entrega uma mensagem ao bot e resolve quando ele terminou de processá-la, com os envios que
   * ela causou já em `sent`. Devolve a mensagem entregue.
   */
  receive(input: IncomingMessage): Promise<Message>;
  /** Simula outro evento do canal (reação, entrada em grupo...) e espera o bot assentar. */
  emit<E extends keyof TransportEvents>(event: E, payload: TransportEvents[E]): Promise<void>;
  /** Para o bot (teardown dos plugins, storage fechado). */
  stop(): Promise<void>;
}

/**
 * Cria e sobe um bot para teste. Os padrões tiram o que só atrapalha num teste: log desligado,
 * ambiente vazio (nenhum `ZAPFORGE_*` da máquina vaza para a config), fila de saída sem
 * intervalo entre envios e sem reconexão. Qualquer um deles pode ser sobrescrito.
 */
export async function createTestBot(options: TestBotOptions = {}): Promise<TestBot> {
  const transport = options.transport ?? new FakeTransport();
  const bot = createBot({
    // Com `logLevel`, quem cria o logger é o bot, com os `secrets` da config.
    ...(options.logLevel === undefined && { logger: createLogger({ level: 'silent' }) }),
    env: {},
    reconnection: false,
    ...options,
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0, ...options.outbound },
    transport,
  });
  await bot.start();
  return {
    bot,
    transport,
    sent: transport.sent,
    async receive(input) {
      const message = buildMessage(input);
      transport.emit('message', message);
      await bot.settled();
      return message;
    },
    async emit(event, payload) {
      transport.emit(event, payload);
      await bot.settled();
    },
    stop: () => bot.stop(),
  };
}
