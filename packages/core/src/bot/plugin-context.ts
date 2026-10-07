// Fábrica do `PluginContext` (M1-16): liga cada campo do contexto ao serviço do bot, sempre em
// nome do plugin, e desfaz tudo no `dispose`. É a única peça que conhece todos os serviços; o
// host de plugins só recebe a fábrica.

import type { CommandDefinition } from '#commands/command.ts';
import type { CommandRouter } from '#commands/router.ts';
import type { PluginConfigs } from '#config/plugin-configs.ts';
import { ContextExpiredError, Deadline } from '#deadline.ts';
import type { EventBus } from '#events/bus.ts';
import type { BotEventName, EventSubscriber } from '#events/types.ts';
import type { Logger } from '#logger/types.ts';
import type { OutboundSendOptions, Sender } from '#outbound/types.ts';
import { type PluginContextFactory, PluginHostStateError } from '#plugin/host.ts';
import type { PluginContext } from '#plugin/types.ts';
import type { SchedulerService } from '#scheduler/service.ts';
import type { Scheduler } from '#scheduler/types.ts';
import type { ServiceRegistry } from '#services/registry.ts';
import type { ServiceAccess } from '#services/types.ts';
import { pluginStorage } from '#storage/namespace.ts';
import type {
  Collection,
  CollectionOptions,
  JsonValue,
  KeyValueStore,
  PluginStorage,
  StoragePort,
} from '#storage/types.ts';
import type { OutgoingContent, Unsubscribe } from '#transport/types.ts';
import type { UnsafeAccess } from '#unsafe/access.ts';
import { type CommandViews, commandViewFactory, listenerViewFactory } from './message-context.ts';

export interface PluginContextDeps {
  readonly configs: PluginConfigs;
  readonly log: Logger;
  readonly router: CommandRouter;
  readonly bus: EventBus;
  readonly services: ServiceRegistry;
  readonly storage: StoragePort;
  readonly scheduler: SchedulerService;
  readonly send: Sender;
  readonly unsafe: UnsafeAccess;
  /** Prazo do `run` de cada comando, em ms (ADR 0005). */
  readonly commandTimeoutMs: number;
  /** Destino da rejeição de um `run` que chegou depois do prazo (já reportado como timeout). */
  readonly onLateCommandError: (plugin: string, command: string, error: unknown) => void;
}

/** O `run` de um comando estourou o prazo. Vai em `plugin.error` com `timedOut: true`. */
export class CommandTimeoutError extends Error {
  override readonly name = 'CommandTimeoutError';
  readonly plugin: string;
  readonly command: string;
  readonly timeoutMs: number;

  constructor(plugin: string, command: string, timeoutMs: number) {
    super(`comando "${command}" do plugin "${plugin}" excedeu ${timeoutMs} ms`);
    this.plugin = plugin;
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

/** Eventos cujo payload é uma `Message`: os listeners deles recebem os campos de mensagem. */
export function isMessageEvent(event: BotEventName): boolean {
  return event === 'message' || event === 'message.edited' || event.startsWith('message:');
}

export function createPluginContextFactory(deps: PluginContextDeps): PluginContextFactory {
  return async (plugin) => {
    const { name } = plugin;
    // Lança `PluginConfigError` com config inválida: o host ignora o plugin (ADR 0032).
    const { config, messages } = await deps.configs.resolve(name);
    const log = deps.log.child({ plugin: name });

    // Um `setup` que estourou o prazo segue rodando em segundo plano (não há como abortá-lo).
    // Depois do `dispose`, tudo o que ele registrar ficaria órfão e todo efeito (envio,
    // storage, agendamento) viria de um plugin que já desceu: o contexto recusa, e o `signal`
    // dele aborta (ADR 0033).
    const lifetime = new Deadline();
    const guard = (what: string): void => {
      if (lifetime.expired) {
        throw new PluginHostStateError(
          `plugin "${name}": ${what} depois que o contexto foi descartado (setup que estourou ` +
            'o prazo, ou registro depois do teardown)',
        );
      }
    };
    /** Rejeição (com log) de uma operação assíncrona do contexto descartado. */
    const refuse = (operation: string): Promise<never> => {
      const error = new ContextExpiredError(name, operation, 'contexto do plugin', lifetime.reason);
      log.warn(`${operation} recusado: contexto do plugin já foi descartado`, {
        operation,
        err: error,
      });
      return Promise.reject(error);
    };
    const live: Live =
      (operation, fn) =>
      (...args) =>
        lifetime.expired ? refuse(operation) : fn(...args);

    const commandViews = commandViewFactory(name, log);
    const listenerView = listenerViewFactory(name, log);
    // Nos eventos de mensagem, cada listener recebe a visão com `message`/`text`/`reply`/`log`
    // do plugin; o barramento a cria (uma por listener) e pendura nela o `Deadline`.
    const events = deps.bus.forPlugin(name, {
      view: (event) => (isMessageEvent(event) ? listenerView : undefined),
    });
    const services = deps.services.forPlugin(name);
    const scheduler = deps.scheduler.forPlugin(name);

    const context: PluginContext = {
      plugin: { name, version: plugin.version, messages },
      config,
      log,
      get signal(): AbortSignal {
        return lifetime.signal;
      },
      commands: {
        add(definition: CommandDefinition): void {
          guard('commands.add');
          deps.router.registry.add(name, wrapCommand(name, definition, commandViews, deps));
        },
      },
      events: {
        on(event: BotEventName, first: unknown, second?: unknown): Unsubscribe {
          guard('events.on');
          return (events.on as AnySubscribe)(event, first, second);
        },
      } as EventSubscriber,
      services: {
        provide(service, implementation) {
          guard('services.provide');
          services.provide(service, implementation);
        },
        get: (service) => services.get(service),
        has: (service) => services.has(service),
      } satisfies ServiceAccess,
      storage: liveStorage(pluginStorage(deps.storage, name), live),
      scheduler: {
        at: live('scheduler.at', (when: Date | number, job: string, payload?: JsonValue) =>
          scheduler.at(when, job, payload),
        ),
        cancel: live('scheduler.cancel', (id: string) => scheduler.cancel(id)),
        on(job, handler) {
          guard('scheduler.on');
          return scheduler.on(job, handler);
        },
      } satisfies Scheduler,
      send: {
        send: live(
          'send',
          (chatId: string, content: OutgoingContent, options?: OutboundSendOptions) =>
            deps.send.send(chatId, content, options),
        ),
      },
      unsafe: deps.unsafe.forPlugin(plugin),
    };

    return {
      context,
      dispose(reason?: unknown): void {
        lifetime.expire(
          reason ?? new PluginHostStateError(`plugin "${name}": contexto descartado`),
        );
        deps.router.registry.removePlugin(name);
        deps.bus.removePlugin(name);
        deps.services.removePlugin(name);
        deps.scheduler.removePlugin(name);
      },
    };
  };
}

/** Embrulha uma operação assíncrona para rejeitar com `ContextExpiredError` após o `dispose`. */
type Live = <A extends unknown[], R>(
  operation: string,
  fn: (...args: A) => Promise<R>,
) => (...args: A) => Promise<R>;

/**
 * Storage do plugin com cada operação (KV e coleções) recusada depois do `dispose`. A checagem é
 * na chamada: uma coleção obtida antes do descarte também passa a recusar.
 */
function liveStorage(storage: PluginStorage, live: Live): PluginStorage {
  const { kv } = storage;
  const liveKv: KeyValueStore = {
    get: live('storage.kv.get', (key: string) => kv.get(key)) as KeyValueStore['get'],
    set: live('storage.kv.set', (key: string, value: JsonValue) => kv.set(key, value)),
    delete: live('storage.kv.delete', (key: string) => kv.delete(key)),
  };
  return {
    kv: liveKv,
    collection<T extends { readonly [key: string]: JsonValue }>(
      collectionName: string,
      options?: CollectionOptions,
    ): Collection<T> {
      const collection = storage.collection<T>(collectionName, options);
      const op = (method: string): string => `storage.collection("${collectionName}").${method}`;
      type C = Collection<T>;
      return {
        insert: live(op('insert'), (document: T) => collection.insert(document)),
        get: live(op('get'), (id: string) => collection.get(id)),
        find: live(op('find'), (query?: Parameters<C['find']>[0]) => collection.find(query)),
        update: live(
          op('update'),
          (target: Parameters<C['update']>[0], patch: Parameters<C['update']>[1]) =>
            collection.update(target, patch),
        ),
        delete: live(op('delete'), (target: Parameters<C['delete']>[0]) =>
          collection.delete(target),
        ),
      };
    },
  };
}

type AnySubscribe = (event: BotEventName, first: unknown, second: unknown) => Unsubscribe;

/**
 * Comando com o `log` do plugin dono no contexto de `run` e `onReject`, e `run` com prazo: um
 * `run` preso seguraria o chat na fila de entrada para sempre (ADR 0005).
 */
function wrapCommand(
  plugin: string,
  definition: CommandDefinition,
  views: CommandViews,
  deps: Pick<PluginContextDeps, 'commandTimeoutMs' | 'onLateCommandError'>,
): CommandDefinition {
  const { run, onReject, name } = definition;
  return {
    ...definition,
    run: (ctx) => {
      const deadline = new Deadline();
      const result = run(views.run(ctx, deadline));
      return withDeadline(
        result,
        deadline,
        deps.commandTimeoutMs,
        plugin,
        name,
        deps.onLateCommandError,
      );
    },
    ...(onReject && { onReject: (ctx, rejection) => onReject(views.reject(ctx), rejection) }),
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * Corre o resultado do `run` contra o prazo. O `run` não tem como ser cancelado e segue em
 * segundo plano; o chat é liberado, o `signal` do comando aborta e o `reply` dele passa a ser
 * recusado (ADR 0033). Uma rejeição depois do prazo vai para `onLate`, nunca vira rejeição não
 * tratada. `run` síncrono passa direto, sem timer.
 */
function withDeadline(
  result: unknown,
  deadline: Deadline,
  timeoutMs: number,
  plugin: string,
  command: string,
  onLate: PluginContextDeps['onLateCommandError'],
): unknown {
  if (!isThenable(result)) return result;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      const error = new CommandTimeoutError(plugin, command, timeoutMs);
      deadline.expire(error);
      reject(error);
    }, timeoutMs);
    result.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          onLate(plugin, command, error);
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
