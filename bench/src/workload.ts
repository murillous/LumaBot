// Bot de referência dos cenários: 20 plugins, os middlewares oficiais mais um do app, comandos e
// listeners que respondem. Os cenários medem o kernel com esta carga, então ela precisa passar
// por todo o caminho da mensagem (middlewares → roteador → barramento → fila de saída).

import { setImmediate as nextTick } from 'node:timers/promises';
import { command, definePlugin, type Message, type PluginDefinition } from '@zapforge/core';
import { createMessage } from '@zapforge/core/adapter';
import { createTestBot, type TestBot } from '@zapforge/testing/bot';
import { z } from 'zod';

/** Plugins do bot de referência (meta de boot do plano §7). */
export const PLUGIN_COUNT = 20;

/** Chats por onde as mensagens circulam (meta de vazão do plano §7). */
export const CHAT_COUNT = 500;

/** O bot de referência e os contadores que os cenários conferem no fim. */
export interface Workload {
  readonly bot: TestBot;
  /** `plugin.error` vistos. Um cenário com erro mede o caminho de erro, não o normal. */
  readonly pluginErrors: () => number;
}

/** Sobe o bot de referência sobre o `FakeTransport`, com a fila de saída sem intervalo (D47). */
export async function createWorkload(): Promise<Workload> {
  let pluginErrors = 0;
  const plugins = Array.from({ length: PLUGIN_COUNT }, (_, i) => benchPlugin(i));
  const observer = definePlugin({
    name: 'bench-observer',
    version: '1.0.0',
    engine: '*',
    setup(ctx) {
      ctx.events.on('plugin.error', () => {
        pluginErrors++;
      });
    },
  });
  const bot = await createTestBot({
    plugins: [observer, ...plugins],
    middlewares: {
      // `rateLimit` por remetente com teto alto: entra no caminho sem barrar mensagem, e o
      // cenário de memória pega um `Map` por remetente que nunca se limpa (o vazamento do
      // `rateLimiter` do legacy).
      rateLimit: { max: 1_000_000, windowMs: 1000 },
      chatFilter: { block: ['bloqueado@fake'] },
      use: [(_ctx, next) => next()],
    },
  });
  // Um plugin ignorado no boot (manifesto, config, engine) deixaria a carga mais leve sem aviso.
  const skipped = bot.bot.plugins().filter((entry) => entry.status === 'skipped');
  if (skipped.length > 0) {
    await bot.stop();
    const names = skipped.map((entry) => entry.name).join(', ');
    throw new Error(`plugins do benchmark ignorados no boot: ${names}`);
  }
  return { bot, pluginErrors: () => pluginErrors };
}

/**
 * Plugin genérico com config Zod, mensagens, comandos e listeners. O `bench-0` é o que responde:
 * `!ping` e `oi` geram uma resposta cada, e um listener espera um ciclo do event loop, como um
 * plugin que faz I/O (ADR 0042). Os demais `dependsOn` dele, para o boot ordenar o grafo.
 */
function benchPlugin(index: number): PluginDefinition {
  const name = `bench-${index}`;
  return definePlugin({
    name,
    version: '1.0.0',
    engine: '*',
    ...(index > 0 && { dependsOn: { 'bench-0': '^1.0.0' } }),
    config: z.object({
      enabled: z.boolean().default(true),
      limit: z.number().int().min(1).default(10),
      greeting: z.string().default('olá'),
    }),
    messages: { pong: 'pong' },
    setup(ctx) {
      ctx.commands.add(
        command({
          name: index === 0 ? 'ping' : `${name}-a`,
          run: async (c) => {
            await c.reply(ctx.plugin.messages.pong);
          },
        }),
      );
      ctx.commands.add(
        command({ name: `${name}-b`, aliases: [`b${index}`], run: () => undefined }),
      );
      ctx.events.on('message', async (e) => {
        if (index === 0 && e.text === 'oi') await e.reply(ctx.config.greeting);
      });
      ctx.events.on('message:image', () => undefined);
      if (index === 0) {
        ctx.events.on('message', async () => {
          await nextTick();
        });
      }
    },
  });
}

/** O que a mensagem `i` da carga faz: comando, texto que o listener responde ou texto solto. */
export type MessageKind = 'command' | 'reply' | 'silent';

const KINDS: readonly MessageKind[] = ['command', 'reply', 'silent'];
const TEXTS: Record<MessageKind, string> = { command: '!ping', reply: 'oi', silent: 'nada' };

export function kindOf(index: number): MessageKind {
  return KINDS[index % KINDS.length] as MessageKind;
}

/** Respostas que a mensagem `i` gera no bot de referência. */
export function repliesOf(index: number): number {
  return kindOf(index) === 'silent' ? 0 : 1;
}

/**
 * Mensagem `i` da carga, no chat `i % CHAT_COUNT`. Cada mensagem tem remetente próprio: um estado
 * por remetente que não se limpa cresce com cada mensagem e aparece no cenário de memória.
 */
export function messageAt(index: number): Message {
  return createMessage({
    type: 'text',
    id: `bench-${index}`,
    chat: { id: `chat-${index % CHAT_COUNT}@fake`, isGroup: false },
    sender: { id: `user-${index}@fake`, name: null, phone: null },
    timestamp: Date.now(),
    fromMe: false,
    text: TEXTS[kindOf(index)],
  });
}
