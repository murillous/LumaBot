import {
  type Bot,
  type BotConfig,
  type Chat,
  type Contact,
  createBot,
  createLogger,
  type Message,
} from '@zapforge/core';
import type { TransportEvents } from '@zapforge/core/adapter';
import { FakeTransport, type SentMessage } from './fake-transport.ts';
import { buildMessage, DEFAULT_SENDER, type IncomingMessage } from './incoming.ts';

/** Quem clica e onde, no `click()`. */
export interface ClickOptions {
  /** Campos do remetente que diferem de `DEFAULT_SENDER`. */
  readonly sender?: Partial<Contact>;
  /** Padrão: o chat da mensagem que o envio cita ou, sem citação, conversa privada no `chatId`. */
  readonly chat?: Chat;
}

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
  /**
   * Clica no botão de rótulo `label` do envio (ADR 0062) e espera o bot assentar. Lança se o
   * envio não tem esse botão: num transport sem a capability `actions`, o menu sai em texto, e o
   * teste responde com o número pelo `receive()`.
   */
  click(sent: SentMessage, label: string, options?: ClickOptions): Promise<void>;
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
  let clicks = 0;
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
    async click(sent, label, options = {}) {
      const action = sent.actions?.find((candidate) => candidate.label === label);
      if (action === undefined) {
        const labels = sent.actions?.map((candidate) => candidate.label) ?? [];
        throw new Error(
          `click: o envio não tem o botão ${JSON.stringify(label)} (botões: ${JSON.stringify(labels)})`,
        );
      }
      clicks++;
      transport.emit('interaction', {
        id: `click-${clicks}`,
        chat: options.chat ?? sent.quoted?.chat ?? { id: sent.chatId, isGroup: false },
        sender: { ...DEFAULT_SENDER, ...options.sender },
        actionId: action.id,
        timestamp: Date.now(),
      });
      await bot.settled();
    },
    async emit(event, payload) {
      transport.emit(event, payload);
      await bot.settled();
    },
    stop: () => bot.stop(),
  };
}
