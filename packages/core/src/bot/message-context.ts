// Contexto de mensagem do kernel (M1-16): o objeto que middlewares, roteador e listeners
// recebem. `reply` e `log` são preguiçosos — a maioria das mensagens não responde nem loga, e o
// caminho quente (§7 do plano) não deve alocar o que ninguém vai usar.

import type { BotMessageContext } from '#context.ts';
import { ContextExpiredError, DEADLINE, type Deadline, deadlineOf } from '#deadline.ts';
import type { MessageListenerFields } from '#events/types.ts';
import type { LogFields, Logger } from '#logger/types.ts';
import type { Message } from '#message/types.ts';
import type { SanitizedContext, SanitizedFields } from '#middleware/sanitize.ts';
import { createReply } from '#outbound/reply.ts';
import type { Reply, Sender } from '#outbound/types.ts';
import type { MessageKey } from '#transport/types.ts';

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

const REPLY_METHODS = [
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'sticker',
  'document',
  'poll',
] as const satisfies readonly (keyof Reply)[];

/** Recusa uma operação de um contexto expirado: loga e devolve a rejeição. */
type Refuse = (operation: string) => Promise<never>;

/**
 * `reply` que confere o prazo a cada chamada — não só na leitura de `ctx.reply`: quem guardou a
 * função antes do prazo (`const r = ctx.reply`) também é recusado depois dele.
 */
function expiringReply(reply: Reply, deadline: Deadline, refuse: Refuse): Reply {
  const guard =
    <A extends unknown[]>(operation: string, send: (...args: A) => Promise<MessageKey>) =>
    (...args: A): Promise<MessageKey> =>
      deadline.expired ? refuse(operation) : send(...args);
  type AnySend = (...args: unknown[]) => Promise<MessageKey>;
  const shortcuts = Object.fromEntries(
    REPLY_METHODS.map((method) => [method, guard(`reply.${method}`, reply[method] as AnySend)]),
  ) as unknown as Pick<Reply, (typeof REPLY_METHODS)[number]>;
  return Object.assign(guard('reply', reply), shortcuts);
}

interface ExpiringView {
  readonly [DEADLINE]?: Deadline;
  readonly log: Logger;
}

/**
 * Descritor do `reply` de uma execução com prazo (comando ou listener): o `reply` de `base`,
 * recusado com `ContextExpiredError` (e uma linha de log) depois que o `Deadline` expira.
 * Criado no primeiro acesso e fixado no próprio objeto, como o `log`.
 */
function expiringReplyDescriptor<V extends ExpiringView>(
  plugin: string,
  base: (view: V) => Reply | undefined,
  scope: (view: V) => { readonly label: string; readonly fields: LogFields },
): PropertyDescriptor {
  return {
    configurable: true,
    get(this: V): Reply | undefined {
      const reply = base(this);
      const deadline = deadlineOf(this);
      if (reply === undefined || deadline === undefined) return reply;
      const refuse: Refuse = (operation) => {
        const { label, fields } = scope(this);
        const error = new ContextExpiredError(plugin, operation, label, deadline.reason);
        this.log.warn(`${operation} recusado: ${label} já estourou o prazo`, {
          ...fields,
          operation,
          err: error,
        });
        return Promise.reject(error);
      };
      const guarded = expiringReply(reply, deadline, refuse);
      Object.defineProperty(this, 'reply', { value: guarded });
      return guarded;
    },
  };
}

const signalDescriptor: PropertyDescriptor = {
  get(this: ExpiringView): AbortSignal {
    return (deadlineOf(this) as Deadline).signal;
  },
};

export interface CommandViews {
  /** Contexto do `run`: `log` do plugin, `signal` e `reply` presos ao `deadline` do comando. */
  run<C extends object>(ctx: C, deadline: Deadline): C;
  /** Contexto do `onReject`: só o `log` do plugin (sem prazo). */
  reject<C extends object>(ctx: C): C;
}

/** Deriva os contextos de comando de um plugin. */
export function commandViewFactory(plugin: string, pluginLog: Logger): CommandViews {
  type View = ExpiringView & { readonly command: string };
  const log = pluginLogDescriptor(pluginLog);
  const runDescriptors: PropertyDescriptorMap = {
    log,
    signal: signalDescriptor,
    reply: expiringReplyDescriptor<View>(
      plugin,
      // O `reply` do contexto do kernel, alcançado pela cadeia de protótipos.
      (view) => (Object.getPrototypeOf(view) as { readonly reply?: Reply }).reply,
      (view) => ({ label: `comando "${view.command}"`, fields: { command: view.command } }),
    ),
  };
  const rejectDescriptors: PropertyDescriptorMap = { log };
  return {
    run(ctx, deadline) {
      const view = Object.create(ctx, runDescriptors) as { [DEADLINE]?: Deadline };
      view[DEADLINE] = deadline;
      return view as typeof ctx;
    },
    reject: (ctx) => Object.create(ctx, rejectDescriptors),
  };
}

/**
 * Deriva, para um listener de evento de mensagem, a visão com `message`, `text`, `reply` e `log`
 * (do plugin). O objeto do barramento fica no protótipo: `claimed`/`claim()` seguem
 * compartilhados entre os listeners da emissão; o barramento pendura na visão o `Deadline` do
 * listener, que dá o `signal` e prende o `reply`.
 */
export function listenerViewFactory(
  plugin: string,
  pluginLog: Logger,
): <C extends object>(ctx: C) => C {
  type View = Partial<WithKernelContext> &
    ExpiringView & {
      readonly payload: Message;
      readonly event: string;
    };
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
    reply: expiringReplyDescriptor<View>(
      plugin,
      (view) => kernel(view)?.reply,
      (view) => ({ label: `listener de "${view.event}"`, fields: { event: view.event } }),
    ),
    log: pluginLogDescriptor(pluginLog),
  } satisfies Record<keyof MessageListenerFields, PropertyDescriptor>;
  return (ctx) => Object.create(ctx, descriptors);
}
