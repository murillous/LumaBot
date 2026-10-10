import {
  type Bot,
  type BotConfig,
  type Chat,
  type Contact,
  createBot,
  createLogger,
  type Message,
} from '@zapforge/core';
import type { Interaction, TransportEvents } from '@zapforge/core/adapter';
import { FakeTransport, type SentMessage } from './fake-transport.ts';
import { buildMessage, type IncomingMessage } from './incoming.ts';
import { DEFAULT_SENDER, PROFILES, type ProfileName } from './profiles.ts';

/** Quem clica e onde, no `click()`. */
export interface ClickOptions {
  /** Campos do remetente que diferem do padrão: o do perfil ou `DEFAULT_SENDER`. */
  readonly sender?: Partial<Contact>;
  /** Padrão: o chat da mensagem que o envio cita ou, sem citação, conversa privada no `chatId`. */
  readonly chat?: Chat;
  /** Objeto bruto falso da interação, que o `ctx.unsafe.raw()` devolve (ADR 0066). */
  readonly raw?: unknown;
}

export interface TestBotOptions extends Omit<BotConfig, 'transport'> {
  /** Padrão: um `FakeTransport` do `profile` ou, sem perfil, com todas as capabilities. */
  readonly transport?: FakeTransport;
  /**
   * Perfil da plataforma (ADR 0073), atalho para `transport: new FakeTransport({ profile })`. Não
   * combina com `transport`: o perfil vai no transport.
   */
  readonly profile?: ProfileName;
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
  const { profile, ...config } = options;
  if (profile !== undefined && config.transport !== undefined) {
    throw new TypeError('createTestBot: passe `profile` ou `transport`, não os dois');
  }
  const transport = config.transport ?? new FakeTransport(profile === undefined ? {} : { profile });
  // O remetente padrão segue o perfil: sem telefone no Telegram, no Discord e no web.
  const sender =
    transport.profile === undefined ? DEFAULT_SENDER : PROFILES[transport.profile].sender;
  const bot = createBot({
    // Com `logLevel`, quem cria o logger é o bot, com os `secrets` da config.
    ...(config.logLevel === undefined && { logger: createLogger({ level: 'silent' }) }),
    env: {},
    reconnection: false,
    ...config,
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0, ...config.outbound },
    transport,
  });
  await bot.start();
  // Contadores do bot, não do módulo (ADR 0004): os IDs recomeçam em cada `TestBot`.
  let received = 0;
  const build = { nextId: () => `in-${++received}`, sender };
  let clicks = 0;
  return {
    bot,
    transport,
    sent: transport.sent,
    async receive(input) {
      const message = buildMessage(input, build);
      registerRaw(transport, message, input);
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
      const interaction: Interaction = {
        id: `click-${clicks}`,
        chat: options.chat ?? sent.quoted?.chat ?? { id: sent.chatId, isGroup: false },
        sender: { ...sender, ...options.sender },
        actionId: action.id,
        timestamp: Date.now(),
      };
      if ('raw' in options) transport.setRaw(interaction, options.raw);
      transport.emit('interaction', interaction);
      await bot.settled();
    },
    async emit(event, payload) {
      transport.emit(event, payload);
      await bot.settled();
    },
    stop: () => bot.stop(),
  };
}

/** O `raw` da descrição vai para o transport, na mensagem e na citada descrita (ADR 0066). */
function registerRaw(transport: FakeTransport, message: Message, input: IncomingMessage): void {
  if ('raw' in input) transport.setRaw(message, input.raw);
  const quoted = input.quoted;
  // A citada já pronta (`Message`) não tem descrição: quem a montou registra com `setRaw`.
  if (quoted !== undefined && !('is' in quoted) && message.quoted !== null) {
    registerRaw(transport, message.quoted, quoted);
  }
}
