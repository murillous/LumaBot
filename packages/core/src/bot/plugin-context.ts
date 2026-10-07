// Fábrica do `PluginContext` (M1-16): liga cada campo do contexto ao serviço do bot, sempre em
// nome do plugin, e desfaz tudo no `dispose`. É a única peça que conhece todos os serviços; o
// host de plugins só recebe a fábrica.

import type { CommandDefinition } from '#commands/command.ts';
import type { CommandRouter } from '#commands/router.ts';
import type { PluginConfigs } from '#config/plugin-configs.ts';
import type { EventBus } from '#events/bus.ts';
import type { BotEventName, EventSubscriber } from '#events/types.ts';
import type { Logger } from '#logger/types.ts';
import type { Sender } from '#outbound/types.ts';
import { type PluginContextFactory, PluginHostStateError } from '#plugin/host.ts';
import type { PluginContext } from '#plugin/types.ts';
import type { SchedulerService } from '#scheduler/service.ts';
import type { Scheduler } from '#scheduler/types.ts';
import type { ServiceRegistry } from '#services/registry.ts';
import type { ServiceAccess } from '#services/types.ts';
import { pluginStorage } from '#storage/namespace.ts';
import type { StoragePort } from '#storage/types.ts';
import type { Unsubscribe } from '#transport/types.ts';
import type { UnsafeAccess } from '#unsafe/access.ts';
import { commandViewFactory, listenerViewFactory } from './message-context.ts';

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
    // Depois do `dispose`, tudo o que ele registrar ficaria órfão: o contexto recusa.
    let disposed = false;
    const guard = (what: string): void => {
      if (disposed) {
        throw new PluginHostStateError(
          `plugin "${name}": ${what} depois que o contexto foi descartado (setup que estourou ` +
            'o prazo, ou registro depois do teardown)',
        );
      }
    };

    const commandView = commandViewFactory(log);
    const listenerView = listenerViewFactory(log);
    const events = deps.bus.forPlugin(name);
    const services = deps.services.forPlugin(name);
    const scheduler = deps.scheduler.forPlugin(name);

    const context: PluginContext = {
      plugin: { name, version: plugin.version, messages },
      config,
      log,
      commands: {
        add(definition: CommandDefinition): void {
          guard('commands.add');
          deps.router.registry.add(name, withPluginLog(definition, commandView));
        },
      },
      events: {
        on(event: BotEventName, first: unknown, second?: unknown): Unsubscribe {
          guard('events.on');
          if (!isMessageEvent(event)) return (events.on as AnySubscribe)(event, first, second);
          // O contexto do barramento é um só por emissão; o `log` com o nome do plugin precisa
          // de uma visão por listener.
          const wrap = (value: unknown): unknown =>
            typeof value === 'function'
              ? (ctx: object) => (value as (ctx: object) => unknown)(listenerView(ctx))
              : value;
          return (events.on as AnySubscribe)(event, wrap(first), wrap(second));
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
      storage: pluginStorage(deps.storage, name),
      scheduler: {
        at: (when, job, payload) => scheduler.at(when, job, payload),
        cancel: (id) => scheduler.cancel(id),
        on(job, handler) {
          guard('scheduler.on');
          return scheduler.on(job, handler);
        },
      } satisfies Scheduler,
      send: deps.send,
      unsafe: deps.unsafe.forPlugin(plugin),
    };

    return {
      context,
      dispose(): void {
        disposed = true;
        deps.router.registry.removePlugin(name);
        deps.bus.removePlugin(name);
        deps.services.removePlugin(name);
        deps.scheduler.removePlugin(name);
      },
    };
  };
}

type AnySubscribe = (event: BotEventName, first: unknown, second: unknown) => Unsubscribe;

/** Comando com o `log` do plugin dono no contexto de `run` e `onReject`. */
function withPluginLog(
  definition: CommandDefinition,
  view: <C extends object>(ctx: C) => C,
): CommandDefinition {
  const { run, onReject } = definition;
  return {
    ...definition,
    run: (ctx) => run(view(ctx)),
    ...(onReject && { onReject: (ctx, rejection) => onReject(view(ctx), rejection) }),
  };
}
