// Fábrica do `PluginContext` (M1-16): liga cada campo do contexto ao serviço do bot, sempre em
// nome do plugin, e desfaz tudo no `dispose`. É a única peça que conhece todos os serviços; o
// host de plugins só recebe a fábrica.

import { commandInfo } from '#commands/catalog.ts';
import type { CommandDefinition } from '#commands/command.ts';
import type { Prefixes } from '#commands/prefixes.ts';
import { type RoleCheck, RoleTimeoutError } from '#commands/roles.ts';
import type { CommandRouter } from '#commands/router.ts';
import type { PluginConfigs } from '#config/plugin-configs.ts';
import {
  type ConversationRegistry,
  type KernelStep,
  type StepContext,
  type StepHandler,
  StepTimeoutError,
} from '#conversations/conversations.ts';
import {
  type ArmedTimers,
  ContextExpiredError,
  Deadline,
  ExecutionTimeoutError,
  settleWithin,
} from '#deadline.ts';
import type { EventBus } from '#events/bus.ts';
import type { BotEventName, EventSubscriber, PluginErrorEvent } from '#events/types.ts';
import type { Groups } from '#groups/groups.ts';
import type { Logger } from '#logger/types.ts';
import type { Contact } from '#message/types.ts';
import type { Outbound } from '#outbound/types.ts';
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
import type { Capability } from '#transport/capabilities.ts';
import type { Unsubscribe } from '#transport/types.ts';
import type { UnsafeAccess } from '#unsafe/access.ts';
import {
  type CommandViews,
  commandViewFactory,
  type KernelMessageContext,
  listenerViewFactory,
  type PluginExpect,
  roleViewFactory,
  stepViewFactory,
} from './message-context.ts';

export interface PluginContextDeps {
  readonly configs: PluginConfigs;
  readonly log: Logger;
  readonly router: CommandRouter;
  readonly prefixes: Prefixes;
  /** Passos e esperas de conversa (ADR 0060). */
  readonly conversations: ConversationRegistry<KernelMessageContext>;
  readonly bus: EventBus;
  readonly services: ServiceRegistry;
  readonly storage: StoragePort;
  readonly scheduler: SchedulerService;
  readonly send: Outbound;
  readonly groups: Groups;
  /** Capabilities e contato da sessão, lidos do transport a cada acesso. */
  readonly transport: {
    readonly capabilities: ReadonlySet<Capability>;
    readonly self: Contact | null;
  };
  readonly unsafe: UnsafeAccess;
  /** Prazo do `run` e do `onReject` de cada comando, em ms (ADR 0005). */
  readonly commandTimeoutMs: number;
  /** Destino da rejeição de um `run` que chegou depois do prazo (já reportado como timeout). */
  readonly onLateCommandError: (plugin: string, command: string, error: unknown) => void;
  /** Checagem de papel custom que lançou, rejeitou ou estourou o prazo (`phase: 'role'`). */
  readonly onRoleError: (event: PluginErrorEvent) => void;
  /** Prazos armados de comandos e papéis, para o shutdown desarmá-los. */
  readonly armed: ArmedTimers;
}

/** Parte do comando que roda código de plugin com prazo. */
export type CommandStage = 'run' | 'onReject';

/**
 * O `run` ou o `onReject` de um comando estourou o prazo. Vai em `plugin.error` com
 * `timedOut: true`.
 */
export class CommandTimeoutError extends ExecutionTimeoutError {
  override readonly name: string = 'CommandTimeoutError';
  readonly command: string;
  readonly stage: CommandStage;

  constructor(plugin: string, command: string, timeoutMs: number, stage: CommandStage = 'run') {
    super(
      plugin,
      stage === 'run' ? `comando "${command}"` : `onReject do comando "${command}"`,
      timeoutMs,
    );
    this.command = command;
    this.stage = stage;
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
    // dele aborta (ADR 0033). Comandos, papéis, listeners e jobs ainda em andamento têm
    // `Deadline` filho deste: o `dispose` os expira junto (#200).
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

    // A espera é sempre do plugin dono do contexto: ele só aponta para os próprios passos.
    const expect: PluginExpect = (message, step, options) =>
      deps.conversations.expect(name, message.chat.id, message.sender.id, step, options);
    const commandViews = commandViewFactory(name, log, expect);
    const listenerView = listenerViewFactory(name, log, expect);
    const stepView = stepViewFactory(name, log, expect);
    const roleView = roleViewFactory(log);
    // Nos eventos de mensagem, cada listener recebe a visão com `message`/`text`/`reply`/`log`
    // do plugin; o barramento a cria (uma por listener) e pendura nela o `Deadline`.
    const events = deps.bus.forPlugin(name, {
      view: (event) => (isMessageEvent(event) ? listenerView : undefined),
      lifetime,
    });
    const services = deps.services.forPlugin(name);
    const scheduler = deps.scheduler.forPlugin(name, lifetime);

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
          deps.router.registry.add(
            name,
            wrapCommand(name, definition, commandViews, lifetime, deps),
          );
        },
        list: () => deps.router.registry.list().map(commandInfo),
      },
      roles: {
        define(role, check) {
          guard('roles.define');
          deps.router.roles.define(
            name,
            role,
            wrapRoleCheck(name, role, check, roleView, log, lifetime, deps),
          );
        },
      },
      prefixes: {
        get: (chat) => deps.prefixes.get(chat),
        set: live('prefixes.set', (chatId: string, prefix: string) =>
          deps.prefixes.set(chatId, prefix),
        ),
        reset: live('prefixes.reset', (chatId: string) => deps.prefixes.reset(chatId)),
      } satisfies Prefixes,
      conversations: {
        define(step: string, handler: StepHandler): void {
          guard('conversations.define');
          deps.conversations.define(
            name,
            step,
            wrapStep(name, step, handler, stepView, log, lifetime, deps),
          );
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
      send: liveOutbound(deps.send, live),
      groups: {
        metadata: live('groups.metadata', (groupId: string) => deps.groups.metadata(groupId)),
        updateParticipants: live(
          'groups.updateParticipants',
          (...args: Parameters<Groups['updateParticipants']>) =>
            deps.groups.updateParticipants(...args),
        ),
      } satisfies Groups,
      capabilities: deps.transport.capabilities,
      get self(): Contact | null {
        return deps.transport.self;
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
        deps.router.roles.removePlugin(name);
        deps.conversations.removePlugin(name);
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

/** `ctx.send` com o envio e cada ação recusados depois do `dispose`. */
function liveOutbound(outbound: Outbound, live: Live): Outbound {
  return {
    send: live('send', (...args: Parameters<Outbound['send']>) => outbound.send(...args)),
    react: live('send.react', (...args: Parameters<Outbound['react']>) => outbound.react(...args)),
    edit: live('send.edit', (...args: Parameters<Outbound['edit']>) => outbound.edit(...args)),
    delete: live('send.delete', (...args: Parameters<Outbound['delete']>) =>
      outbound.delete(...args),
    ),
    typing: live('send.typing', (...args: Parameters<Outbound['typing']>) =>
      outbound.typing(...args),
    ),
  };
}

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
 * Comando com o `log` do plugin dono no contexto de `run` e `onReject`, e os dois com prazo: um
 * deles preso seguraria o chat na fila de entrada para sempre (ADR 0005). Cada um tem o próprio
 * `Deadline`, filho do de vida do plugin, que dá o `signal` e prende o `reply` (ADR 0033).
 */
function wrapCommand(
  plugin: string,
  definition: CommandDefinition,
  views: CommandViews,
  lifetime: Deadline,
  deps: Pick<PluginContextDeps, 'commandTimeoutMs' | 'onLateCommandError' | 'armed'>,
): CommandDefinition {
  const { run, onReject, name } = definition;
  const timeoutMs = definition.timeoutMs ?? deps.commandTimeoutMs;
  const timed = <R>(stage: CommandStage, execute: (deadline: Deadline) => R): R => {
    const deadline = new Deadline(lifetime);
    return settleWithin(
      execute(deadline),
      timeoutMs,
      () => {
        const error = new CommandTimeoutError(plugin, name, timeoutMs, stage);
        deadline.expire(error);
        return error;
      },
      (error) => deps.onLateCommandError(plugin, name, error),
      deps.armed,
      deadline,
    ) as R;
  };
  return {
    ...definition,
    run: (ctx) => timed('run', (deadline) => run(views.run(ctx, deadline))),
    ...(onReject && {
      onReject: (ctx, rejection) =>
        timed('onReject', (deadline) => onReject(views.run(ctx, deadline), rejection)),
    }),
  };
}

/**
 * Checagem de papel com prazo e fail-closed (ADR 0035): lançar, rejeitar ou estourar o prazo
 * recusa o comando e vira `plugin.error` do plugin dono do papel, não do dono do comando. Nunca
 * lança. Checagem síncrona passa direto, sem timer.
 */
function wrapRoleCheck(
  plugin: string,
  role: string,
  check: RoleCheck,
  view: ReturnType<typeof roleViewFactory>,
  log: Logger,
  lifetime: Deadline,
  deps: Pick<PluginContextDeps, 'commandTimeoutMs' | 'onRoleError' | 'armed'>,
): RoleCheck {
  const refuse = (error: unknown): false => {
    deps.onRoleError({
      plugin,
      phase: 'role',
      event: role,
      error,
      timedOut: error instanceof RoleTimeoutError,
    });
    return false;
  };
  return (ctx) => {
    const deadline = new Deadline(lifetime);
    let result: unknown;
    try {
      result = check(view(ctx, deadline));
    } catch (error) {
      return refuse(error);
    }
    const settled = settleWithin(
      result,
      deps.commandTimeoutMs,
      () => {
        const error = new RoleTimeoutError(plugin, role, deps.commandTimeoutMs);
        deadline.expire(error);
        return error;
      },
      (error) => log.error(`papel "${role}" rejeitou depois do prazo`, { role, err: error }),
      deps.armed,
    );
    if (!(settled instanceof Promise)) return settled === true;
    return settled.then((granted) => granted === true, refuse);
  };
}

/**
 * Passo de conversa com a visão do plugin e o prazo do comando (`commandMs`): o passo roda dentro
 * da tarefa da fila do chat, e um preso seguraria o chat como um comando preso (ADR 0042). Tem o
 * próprio `Deadline`, filho do de vida do plugin, como o comando.
 */
function wrapStep(
  plugin: string,
  step: string,
  handler: StepHandler,
  view: ReturnType<typeof stepViewFactory>,
  log: Logger,
  lifetime: Deadline,
  deps: Pick<PluginContextDeps, 'commandTimeoutMs' | 'armed'>,
): KernelStep<KernelMessageContext> {
  const timeoutMs = deps.commandTimeoutMs;
  return (ctx, data) => {
    const deadline = new Deadline(lifetime);
    return settleWithin(
      handler(view(ctx, deadline, step, data) as unknown as StepContext),
      timeoutMs,
      () => {
        const error = new StepTimeoutError(plugin, step, timeoutMs);
        deadline.expire(error);
        return error;
      },
      (error) => {
        // A recusa de um contexto expirado já foi logada quando aconteceu (ADR 0033).
        if (error instanceof ContextExpiredError) return;
        log.error(`passo "${step}" rejeitou depois do prazo`, { step, err: error });
      },
      deps.armed,
      deadline,
    );
  };
}
