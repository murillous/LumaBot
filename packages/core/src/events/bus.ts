import {
  ArmedTimers,
  ContextExpiredError,
  DEADLINE,
  Deadline,
  deadlineOf,
  ListenerTimeoutError,
} from '#deadline.ts';
import type { Message, MessageType } from '#message/types.ts';
import type { Unsubscribe } from '#transport/types.ts';
import type {
  BotEventName,
  BotEvents,
  EventSubscriber,
  ListenerContext,
  ListenerExtras,
  MessageFilter,
  MessageTypeEvents,
  PluginErrorEvent,
  SubscribeOptions,
} from './types.ts';

/** Eventos que se emitem diretamente. `message:<type>` não entra: o bus o deriva de `message`. */
export type EmittableEventName = Exclude<BotEventName, keyof MessageTypeEvents>;

/**
 * Extras do contexto. Opcionais para o barramento: ele só os copia, sem conferir. Nos eventos de
 * mensagem o `ListenerContext` declara `MessageListenerFields`, e quem garante que eles chegam é
 * o `Bot`, que monta o contexto de cada plugin (M1-16); quem usa o barramento solto e emite
 * mensagem sem extras entrega listeners sem esses campos.
 */
export type EmitExtras<E extends BotEventName> = [extras?: ListenerExtras<E>];

export interface EmitResult {
  /** Listeners que rodaram (os barrados pelo filtro não contam). */
  readonly listeners: number;
  /** Algum listener chamou `claim()`, antes ou depois do primeiro `await`. */
  readonly claimed: boolean;
  /** Listeners que lançaram, rejeitaram ou estouraram o prazo. */
  readonly failed: number;
}

export interface EventBusOptions {
  /** Prazo padrão de cada listener em ms; `ListenerOptions.timeoutMs` sobrescreve. Padrão: 30000. */
  readonly listenerTimeoutMs?: number;
  /**
   * Destino garantido de toda falha de listener (o log do kernel). Recebe também as falhas que
   * não viram evento: as dos listeners de `plugin.error` e as rejeições que chegam depois do
   * prazo. Não deve lançar.
   */
  readonly onError: (error: PluginErrorEvent) => void;
  /** Onde ficam os prazos armados dos listeners, para o shutdown do `Bot` desarmá-los. */
  readonly armed?: ArmedTimers;
}

/** Deriva o contexto que um listener recebe a partir do contexto da emissão. */
export type ListenerView = <C extends object>(ctx: C) => C;

export interface PluginSubscriberOptions {
  /**
   * Visão por listener para os listeners deste plugin no `event` assinado; `undefined` usa a
   * padrão (`Object.create(ctx)`). A visão precisa herdar do contexto recebido. O `Bot` a usa
   * para pôr `message`/`text`/`reply`/`log` do plugin nos eventos de mensagem sem uma segunda
   * camada de protótipo no caminho quente.
   */
  readonly view?: (event: BotEventName) => ListenerView | undefined;
  /**
   * `Deadline` de vida do plugin: o de cada listener é filho dele, então o descarte do plugin
   * aborta o `signal` e recusa o `reply` dos listeners ainda em andamento.
   */
  readonly lifetime?: Deadline;
}

export interface EventBus {
  /** Assinatura em nome do plugin: falhas saem com o nome dele e `removePlugin` as desfaz. */
  forPlugin(plugin: string, options?: PluginSubscriberOptions): EventSubscriber;
  /** Remove todos os listeners do plugin (teardown e reload). */
  removePlugin(plugin: string): void;
  /**
   * Inicia todos os listeners do evento, em ordem de prioridade decrescente, sem esperar um
   * pelo outro. `message` alcança também os listeners de `message:<tipo da mensagem>`, numa
   * única ordem e com o mesmo `claim()`. Resolve quando todos assentam (ou estouram o prazo);
   * nunca rejeita, porque cada falha já foi entregue a `plugin.error` e ao `onError`.
   */
  emit<E extends EmittableEventName>(
    event: E,
    payload: BotEvents[E],
    ...extras: EmitExtras<E>
  ): Promise<EmitResult>;
  listenerCount(event: BotEventName): number;
}

export const DEFAULT_LISTENER_TIMEOUT_MS = 30_000;

type AnyContext = ListenerContext<BotEventName>;
type AnyListener = (ctx: AnyContext) => unknown;

interface Entry {
  readonly plugin: string;
  readonly listener: AnyListener;
  readonly priority: number;
  readonly timeoutMs: number;
  /** Ordem de registro, para desempatar prioridades iguais de forma estável entre eventos. */
  readonly seq: number;
  /** Tipos aceitos em `quoted`; `null` sem filtro. */
  readonly quoted: ReadonlySet<MessageType> | null;
  readonly view: ListenerView | undefined;
  readonly lifetime: Deadline | undefined;
}

const NO_ENTRIES: readonly Entry[] = [];
const NO_LISTENERS: Promise<EmitResult> = Promise.resolve({
  listeners: 0,
  claimed: false,
  failed: 0,
});

function compare(a: Entry, b: Entry): number {
  return b.priority - a.priority || a.seq - b.seq;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

function quotedSet(filter: MessageFilter['quoted']): ReadonlySet<MessageType> | null {
  if (filter === undefined) return null;
  return new Set(typeof filter === 'string' ? [filter] : filter);
}

function validTimeout(value: number): number {
  // setTimeout trata Infinity/NaN como 1 ms: o listener estouraria na hora.
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Prazo inválido: ${value}`);
  return value;
}

export function createEventBus(options: EventBusOptions): EventBus {
  const defaultTimeoutMs = validTimeout(options.listenerTimeoutMs ?? DEFAULT_LISTENER_TIMEOUT_MS);
  const onError = options.onError;
  const armed = options.armed ?? new ArmedTimers();
  // Arrays imutáveis (copy-on-write): a emissão percorre o array da vez sem copiar, e quem
  // (des)assina durante uma emissão não afeta a rodada em andamento.
  const byEvent = new Map<string, readonly Entry[]>();
  // `message` + `message:<tipo>` já mesclados por tipo; refeito só quando as assinaturas mudam.
  const messageEntries = new Map<MessageType, readonly Entry[]>();
  let seq = 0;

  function changed(event: string, entries: readonly Entry[]): void {
    if (entries.length === 0) byEvent.delete(event);
    else byEvent.set(event, entries);
    messageEntries.clear();
  }

  function entriesForMessage(type: MessageType): readonly Entry[] {
    let merged = messageEntries.get(type);
    if (merged === undefined) {
      const base = byEvent.get('message') ?? NO_ENTRIES;
      const typed = byEvent.get(`message:${type}`) ?? NO_ENTRIES;
      if (typed.length === 0) merged = base;
      else if (base.length === 0) merged = typed;
      else merged = [...base, ...typed].sort(compare);
      messageEntries.set(type, merged);
    }
    return merged;
  }

  function subscribe(
    plugin: string,
    options: PluginSubscriberOptions | undefined,
    event: BotEventName,
    first: unknown,
    second: unknown,
  ): Unsubscribe {
    const [listener, opts] = (typeof first === 'function' ? [first, second] : [second, first]) as [
      unknown,
      (SubscribeOptions<'message'> & SubscribeOptions<BotEventName>) | undefined,
    ];
    if (typeof listener !== 'function') throw new TypeError(`Listener de "${event}" não é função`);
    const priority = opts?.priority ?? 0;
    // NaN quebraria a comparação do sort e embaralharia a ordem do evento inteiro.
    if (!Number.isFinite(priority)) throw new RangeError(`Prioridade inválida: ${priority}`);
    const entry: Entry = {
      plugin,
      listener: listener as AnyListener,
      priority,
      timeoutMs: opts?.timeoutMs === undefined ? defaultTimeoutMs : validTimeout(opts.timeoutMs),
      seq: seq++,
      quoted: quotedSet(opts?.quoted),
      view: options?.view?.(event),
      lifetime: options?.lifetime,
    };
    changed(event, [...(byEvent.get(event) ?? NO_ENTRIES), entry].sort(compare));
    return () => {
      const current = byEvent.get(event);
      if (!current?.includes(entry)) return;
      changed(
        event,
        current.filter((e) => e !== entry),
      );
    };
  }

  function fail(entry: Entry, event: BotEventName, error: unknown, timedOut: boolean): void {
    const report: PluginErrorEvent = {
      plugin: entry.plugin,
      phase: 'listener',
      event,
      error,
      timedOut,
    };
    onError(report);
    // Falha de um listener de `plugin.error` viraria outro `plugin.error`, em loop: fica só no
    // onError.
    if (event !== 'plugin.error') void emit('plugin.error', report);
  }

  /**
   * Corre a promise do listener contra o prazo; resolve `true` se ele falhou. Estourado o prazo,
   * expira o `Deadline` do listener: o `ctx.signal` dele aborta (ADR 0033).
   */
  function watch(
    entry: Entry,
    event: BotEventName,
    result: PromiseLike<unknown>,
    deadline: Deadline,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const disarm = (): void => {
        settled = true;
        clearTimeout(timer);
        armed.delete(disarm);
      };
      const timer = setTimeout(() => {
        disarm();
        const error = new ListenerTimeoutError(entry.plugin, event, entry.timeoutMs);
        deadline.expire(error);
        fail(entry, event, error, true);
        resolve(true);
      }, entry.timeoutMs);
      armed.add(disarm);
      result.then(
        () => {
          if (settled) return;
          disarm();
          resolve(false);
        },
        (error: unknown) => {
          if (settled) {
            // Já reportado como timeout; o erro tardio só vai para o log. A recusa de um
            // contexto expirado já foi logada quando aconteceu (ADR 0033): não repete.
            if (!(error instanceof ContextExpiredError)) {
              onError({ plugin: entry.plugin, phase: 'listener', event, error, timedOut: false });
            }
            return;
          }
          disarm();
          fail(entry, event, error, false);
          resolve(true);
        },
      );
    });
  }

  function emit<E extends EmittableEventName>(
    event: E,
    payload: BotEvents[E],
    ...[extras]: EmitExtras<E>
  ): Promise<EmitResult> {
    const entries =
      event === 'message'
        ? entriesForMessage((payload as Message).type)
        : (byEvent.get(event) ?? NO_ENTRIES);
    if (entries.length === 0) return NO_LISTENERS;

    // Um contexto por emissão, compartilhado: é o que torna o claim() visível aos demais. Cada
    // listener recebe uma visão derivada dele com o próprio `Deadline`: o prazo é por listener,
    // e um lento expirar não pode abortar o `signal` de outro que está no prazo.
    let claimed = false;
    const ctx = {
      event,
      payload,
      get claimed() {
        return claimed;
      },
      claim() {
        claimed = true;
      },
      get signal(): AbortSignal {
        // `this` é a visão do listener (ou uma derivada dela); o `Deadline` está nela.
        return (deadlineOf(this) as Deadline).signal;
      },
    };
    if (extras !== undefined) Object.assign(ctx, extras);

    let listeners = 0;
    let failed = 0;
    let pending: Promise<boolean>[] | undefined;
    for (const entry of entries) {
      if (entry.quoted !== null) {
        const quoted = (payload as Message).quoted;
        if (!quoted || !entry.quoted.has(quoted.type)) continue;
      }
      listeners++;
      const deadline = new Deadline(entry.lifetime);
      const view: { [DEADLINE]?: Deadline } =
        entry.view === undefined ? Object.create(ctx) : entry.view(ctx);
      view[DEADLINE] = deadline;
      let result: unknown;
      try {
        result = entry.listener(view as unknown as AnyContext);
      } catch (error) {
        failed++;
        fail(entry, event, error, false);
        continue;
      }
      if (isThenable(result)) {
        pending ??= [];
        pending.push(watch(entry, event, result, deadline));
      }
    }

    if (pending === undefined) return Promise.resolve({ listeners, claimed, failed });
    return Promise.all(pending).then((results) => {
      for (const listenerFailed of results) if (listenerFailed) failed++;
      return { listeners, claimed, failed };
    });
  }

  return {
    forPlugin(plugin, options) {
      return {
        on(event: BotEventName, first: unknown, second?: unknown): Unsubscribe {
          return subscribe(plugin, options, event, first, second);
        },
      } as EventSubscriber;
    },

    removePlugin(plugin) {
      for (const [event, entries] of byEvent) {
        const kept = entries.filter((e) => e.plugin !== plugin);
        if (kept.length !== entries.length) changed(event, kept);
      }
    },

    emit,

    listenerCount(event) {
      return byEvent.get(event)?.length ?? 0;
    },
  };
}
