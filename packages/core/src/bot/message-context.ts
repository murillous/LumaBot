// Contexto de mensagem do kernel (M1-16): o objeto que middlewares, roteador e listeners
// recebem. `reply` e `log` são preguiçosos — a maioria das mensagens não responde nem loga, e o
// caminho quente (§7 do plano) não deve alocar o que ninguém vai usar.

import type { BotMessageContext } from '#context.ts';
import type { ExpectReply, ExpectReplyOptions } from '#conversations/conversations.ts';
import { ContextExpiredError, DEADLINE, type Deadline, deadlineOf } from '#deadline.ts';
import type { MessageListenerFields } from '#events/types.ts';
import type { LogFields, Logger } from '#logger/types.ts';
import type { Message } from '#message/types.ts';
import type { SanitizedContext, SanitizedFields } from '#middleware/sanitize.ts';
import { createReply } from '#outbound/reply.ts';
import type { Outbound, Reply } from '#outbound/types.ts';
import type { JsonValue } from '#storage/types.ts';
import type { MessageKey } from '#transport/types.ts';

/** O que o contexto precisa do bot; um objeto por bot, compartilhado por todas as mensagens. */
export interface MessageContextDeps {
  readonly sender: Outbound;
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

  react(emoji: string | null): Promise<void> {
    // Prioridade do `reply`: a reação responde a quem escreveu, como ele.
    return this[STATE].deps.sender.react(this.message.key, emoji, { priority: 'high' });
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
 * função antes do prazo (`const r = ctx.reply`) também é recusado depois dele. No prazo, o envio
 * pausa o relógio até assentar (ADR 0047).
 */
function expiringReply(reply: Reply, deadline: Deadline, refuse: Refuse): Reply {
  const guard =
    <A extends unknown[]>(operation: string, send: (...args: A) => Promise<MessageKey>) =>
    (...args: A): Promise<MessageKey> =>
      deadline.expired ? refuse(operation) : deadline.hold(send(...args));
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

type Scope<V> = (view: V) => { readonly label: string; readonly fields: LogFields };

/** Recusa (com `ContextExpiredError` e uma linha de log) do que a `view` faz depois do prazo. */
function refuser<V extends ExpiringView>(
  plugin: string,
  view: V,
  deadline: Deadline,
  scope: Scope<V>,
): Refuse {
  return (operation) => {
    const { label, fields } = scope(view);
    const error = new ContextExpiredError(plugin, operation, label, deadline.reason);
    view.log.warn(`${operation} recusado: ${label} já expirou`, {
      ...fields,
      operation,
      err: error,
    });
    return Promise.reject(error);
  };
}

/**
 * Descritor do `reply` de uma execução com prazo (comando ou listener): o `reply` de `base`,
 * recusado com `ContextExpiredError` (e uma linha de log) depois que o `Deadline` expira — no
 * prazo, ou no descarte do plugin.
 * Criado no primeiro acesso e fixado no próprio objeto, como o `log`.
 */
function expiringReplyDescriptor<V extends ExpiringView>(
  plugin: string,
  base: (view: V) => Reply | undefined,
  scope: Scope<V>,
): PropertyDescriptor {
  return {
    configurable: true,
    get(this: V): Reply | undefined {
      const reply = base(this);
      const deadline = deadlineOf(this);
      if (reply === undefined || deadline === undefined) return reply;
      const guarded = expiringReply(reply, deadline, refuser(plugin, this, deadline, scope));
      Object.defineProperty(this, 'reply', { value: guarded });
      return guarded;
    },
  };
}

type React = BotMessageContext['react'];

/**
 * Descritor do `react` de uma execução com prazo: recusado depois dele e pausando o relógio no
 * prazo, como o `reply`.
 */
function expiringReactDescriptor<V extends ExpiringView>(
  plugin: string,
  base: (view: V) => Pick<BotMessageContext, 'react'> | undefined,
  scope: Scope<V>,
): PropertyDescriptor {
  return {
    configurable: true,
    get(this: V): React | undefined {
      const target = base(this);
      const deadline = deadlineOf(this);
      if (target === undefined || deadline === undefined) return target?.react;
      const refuse = refuser(plugin, this, deadline, scope);
      const react: React = (emoji) =>
        deadline.expired ? refuse('react') : deadline.hold(target.react(emoji));
      Object.defineProperty(this, 'react', { value: react });
      return react;
    },
  };
}

/** Registra uma espera em nome do plugin; o bot a liga ao registro de conversas (ADR 0060). */
export type PluginExpect = (message: Message, step: string, options?: ExpectReplyOptions) => void;

/**
 * Descritor do `expectReply` de uma execução com prazo: a espera vale para o chat e o remetente
 * da mensagem, e é recusada (com `ContextExpiredError` e uma linha de log) depois do prazo, como
 * o `reply` — senão um handler que estourou registraria uma conversa que ninguém pediu.
 */
function expectReplyDescriptor<V extends ExpiringView & { readonly message: Message }>(
  plugin: string,
  expect: PluginExpect,
  scope: Scope<V>,
): PropertyDescriptor {
  return {
    configurable: true,
    get(this: V): ExpectReply {
      const deadline = deadlineOf(this);
      const expectReply: ExpectReply = (step, options) => {
        if (deadline?.expired) {
          const { label, fields } = scope(this);
          const error = new ContextExpiredError(plugin, 'expectReply', label, deadline.reason);
          this.log.warn(`expectReply recusado: ${label} já expirou`, {
            ...fields,
            operation: 'expectReply',
            err: error,
          });
          throw error;
        }
        expect(this.message, step, options);
      };
      Object.defineProperty(this, 'expectReply', { value: expectReply });
      return expectReply;
    },
  };
}

const signalDescriptor: PropertyDescriptor = {
  get(this: ExpiringView): AbortSignal {
    return (deadlineOf(this) as Deadline).signal;
  },
};

export interface CommandViews {
  /**
   * Contexto do `run` e do `onReject`: `log` do plugin, `signal` e `reply` presos ao `deadline`
   * da execução.
   */
  run<C extends object>(ctx: C, deadline: Deadline): C;
}

/**
 * Descritores comuns às execuções que respondem a uma mensagem (comando e passo): `log` do
 * plugin, `signal`, e `reply`, `react` e `expectReply` presos ao prazo.
 */
function executionDescriptors<V extends ExpiringView & { readonly message: Message }>(
  plugin: string,
  pluginLog: Logger,
  expect: PluginExpect,
  scope: Scope<V>,
): PropertyDescriptorMap {
  return {
    log: pluginLogDescriptor(pluginLog),
    signal: signalDescriptor,
    reply: expiringReplyDescriptor<V>(
      plugin,
      // O `reply` do contexto do kernel, alcançado pela cadeia de protótipos.
      (view) => (Object.getPrototypeOf(view) as { readonly reply?: Reply }).reply,
      scope,
    ),
    react: expiringReactDescriptor<V>(
      plugin,
      (view) => {
        const base = Object.getPrototypeOf(view) as Partial<Pick<BotMessageContext, 'react'>>;
        return base.react === undefined ? undefined : (base as Pick<BotMessageContext, 'react'>);
      },
      scope,
    ),
    expectReply: expectReplyDescriptor<V>(plugin, expect, scope),
  };
}

/** Deriva os contextos de comando de um plugin. */
export function commandViewFactory(
  plugin: string,
  pluginLog: Logger,
  expect: PluginExpect,
): CommandViews {
  type View = ExpiringView & { readonly command: string; readonly message: Message };
  const scope: Scope<View> = (view) => ({
    label: `comando "${view.command}"`,
    fields: { command: view.command },
  });
  const runDescriptors = executionDescriptors<View>(plugin, pluginLog, expect, scope);
  return {
    run(ctx, deadline) {
      const view = Object.create(ctx, runDescriptors) as { [DEADLINE]?: Deadline };
      view[DEADLINE] = deadline;
      return view as typeof ctx;
    },
  };
}

/**
 * Deriva, para os passos de conversa de um plugin, o contexto com `step`, `data` e os campos de
 * execução do comando (`log`, `signal`, `reply`, `react`, `expectReply`).
 */
export function stepViewFactory(
  plugin: string,
  pluginLog: Logger,
  expect: PluginExpect,
): <C extends object>(ctx: C, deadline: Deadline, step: string, data: JsonValue) => C {
  type View = ExpiringView & { readonly step: string; readonly message: Message };
  const scope: Scope<View> = (view) => ({
    label: `passo "${view.step}"`,
    fields: { step: view.step },
  });
  const descriptors = executionDescriptors<View>(plugin, pluginLog, expect, scope);
  return (ctx, deadline, step, data) => {
    const view = Object.create(ctx, descriptors) as { [DEADLINE]?: Deadline };
    Object.assign(view, { step, data });
    view[DEADLINE] = deadline;
    return view as typeof ctx;
  };
}

/**
 * Deriva, para a checagem de um papel custom, a visão com o `log` do plugin dono do papel e o
 * `signal` preso ao `deadline` da checagem.
 */
export function roleViewFactory(
  pluginLog: Logger,
): <C extends object>(ctx: C, deadline: Deadline) => C {
  const descriptors: PropertyDescriptorMap = {
    log: pluginLogDescriptor(pluginLog),
    signal: signalDescriptor,
  };
  return (ctx, deadline) => {
    const view = Object.create(ctx, descriptors) as { [DEADLINE]?: Deadline };
    view[DEADLINE] = deadline;
    return view as typeof ctx;
  };
}

/**
 * Deriva, para um listener de evento de mensagem, a visão com `message`, `text`, `reply`,
 * `react`, `expectReply` e `log` (do plugin). O objeto do barramento fica no protótipo: `claimed`/`claim()` seguem
 * compartilhados entre os listeners da emissão; o barramento pendura na visão o `Deadline` do
 * listener, que dá o `signal` e prende o `reply`.
 */
export function listenerViewFactory(
  plugin: string,
  pluginLog: Logger,
  expect: PluginExpect,
): <C extends object>(ctx: C) => C {
  type View = Partial<WithKernelContext> &
    ExpiringView & {
      readonly payload: Message;
      readonly message: Message;
      readonly event: string;
    };
  const kernel = (view: View): KernelMessageContext | undefined => view[KERNEL_CONTEXT];
  const scope: Scope<View> = (view) => ({
    label: `listener de "${view.event}"`,
    fields: { event: view.event },
  });
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
    reply: expiringReplyDescriptor<View>(plugin, (view) => kernel(view)?.reply, scope),
    react: expiringReactDescriptor<View>(plugin, kernel, scope),
    expectReply: expectReplyDescriptor<View>(plugin, expect, scope),
    log: pluginLogDescriptor(pluginLog),
  } satisfies Record<keyof MessageListenerFields, PropertyDescriptor>;
  return (ctx) => Object.create(ctx, descriptors);
}
