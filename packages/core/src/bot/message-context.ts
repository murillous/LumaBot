// Contexto de mensagem do kernel (M1-16): o objeto que middlewares, roteador e listeners
// recebem. `reply` e `log` são preguiçosos — a maioria das mensagens não responde nem loga, e o
// caminho quente (§7 do plano) não deve alocar o que ninguém vai usar.

import type { BotMessageContext } from '#context.ts';
import type { MessageListenerFields } from '#events/types.ts';
import type { Logger } from '#logger/types.ts';
import type { Message } from '#message/types.ts';
import type { SanitizedContext, SanitizedFields } from '#middleware/sanitize.ts';
import { createReply } from '#outbound/reply.ts';
import type { Reply, Sender } from '#outbound/types.ts';

/** O que o contexto precisa do bot; um objeto por bot, compartilhado por todas as mensagens. */
export interface MessageContextDeps {
  readonly sender: Sender;
  /** Responder citando: só se o transport tem a capability `quoted`. */
  readonly quote: boolean;
  /** Logger raiz; o contexto cria o filho com `chatId` sob demanda. */
  readonly log: () => Logger;
}

// Chave simbólica, não campo `#privado`: o roteador e os listeners recebem objetos derivados por
// `Object.create(ctx)`, e campo privado não é alcançável pela cadeia de protótipos.
const STATE: unique symbol = Symbol('zapforge.messageContext');

interface State {
  readonly deps: MessageContextDeps;
  reply: Reply | undefined;
  log: Logger | undefined;
}

/** O contexto concreto: o de mensagem do bot com o resultado do `sanitize`. */
export interface KernelMessageContext extends BotMessageContext, SanitizedContext {
  text: string | null;
}

/** Cria o contexto de uma mensagem; `reply` e `log` só existem quando lidos. */
export function createMessageContext(
  message: Message,
  deps: MessageContextDeps,
): KernelMessageContext {
  return new MessageContextImpl(message, deps);
}

class MessageContextImpl implements KernelMessageContext {
  readonly message: Message;
  text: string | null;
  /** Preenchido pelo middleware `sanitize`; declarado para manter a forma do objeto estável. */
  sanitized: SanitizedFields | undefined = undefined;
  readonly [STATE]: State;

  constructor(message: Message, deps: MessageContextDeps) {
    this.message = message;
    this.text = message.text;
    this[STATE] = { deps, reply: undefined, log: undefined };
  }

  get reply(): Reply {
    const state = this[STATE];
    state.reply ??= createReply(state.deps.sender, this.message, { quote: state.deps.quote });
    return state.reply;
  }

  get log(): Logger {
    const state = this[STATE];
    state.log ??= state.deps.log().child({ chatId: this.message.chat.id });
    return state.log;
  }
}

/**
 * Chave dos extras que o bot passa ao barramento nos eventos de mensagem. O barramento copia os
 * extras com `Object.assign`, que leria (e criaria) `reply` e `log`; com o contexto inteiro numa
 * chave só, cada listener resolve o que usar.
 */
export const KERNEL_CONTEXT: unique symbol = Symbol('zapforge.kernelContext');

export interface WithKernelContext {
  readonly [KERNEL_CONTEXT]: KernelMessageContext;
}

/** Extras de `bus.emit` para um evento de mensagem. */
export function messageExtras(ctx: KernelMessageContext): WithKernelContext {
  return { [KERNEL_CONTEXT]: ctx };
}

/**
 * Descritores do `log` de um plugin: filho do logger do plugin com o `chatId` da mensagem, criado
 * no primeiro acesso e fixado no próprio objeto. Calculados uma vez por plugin.
 */
function pluginLogDescriptor(pluginLog: Logger): PropertyDescriptor {
  return {
    configurable: true,
    get(this: { readonly message: Message }): Logger {
      const log = pluginLog.child({ chatId: this.message.chat.id });
      Object.defineProperty(this, 'log', { value: log });
      return log;
    },
  };
}

/** Deriva o contexto de comando com o `log` do plugin dono do comando. */
export function commandViewFactory(pluginLog: Logger): <C extends object>(ctx: C) => C {
  const descriptors: PropertyDescriptorMap = { log: pluginLogDescriptor(pluginLog) };
  return (ctx) => Object.create(ctx, descriptors);
}

/**
 * Deriva, para um listener de evento de mensagem, a visão com `message`, `text`, `reply` e `log`
 * (do plugin). O objeto do barramento fica no protótipo: `claimed`/`claim()` seguem
 * compartilhados entre os listeners da emissão.
 */
export function listenerViewFactory(pluginLog: Logger): <C extends object>(ctx: C) => C {
  type View = Partial<WithKernelContext> & { readonly payload: Message };
  const kernel = (view: View): KernelMessageContext | undefined => view[KERNEL_CONTEXT];
  const descriptors: PropertyDescriptorMap = {
    message: {
      get(this: View): Message {
        return this.payload;
      },
    },
    text: {
      get(this: View): string | null {
        const ctx = kernel(this);
        return ctx === undefined ? this.payload.text : ctx.text;
      },
    },
    reply: {
      get(this: View): Reply | undefined {
        return kernel(this)?.reply;
      },
    },
    log: pluginLogDescriptor(pluginLog),
  } satisfies Record<keyof MessageListenerFields, PropertyDescriptor>;
  return (ctx) => Object.create(ctx, descriptors);
}
