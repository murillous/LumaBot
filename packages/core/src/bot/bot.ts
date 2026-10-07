import { CommandConflictError } from '#commands/registry.ts';
import { RoleConflictError } from '#commands/roles.ts';
import { createCommandRouter, type IsGroupAdmin } from '#commands/router.ts';
import type { ConfigEnv } from '#config/env.ts';
import { BotConfigError, normalizeOwners } from '#config/owners.ts';
import {
  createPluginConfigs,
  type PluginConfigFile,
  type PluginConfigs,
} from '#config/plugin-configs.ts';
import type { BotMessageContext } from '#context.ts';
import { ContextExpiredError, settleWithin } from '#deadline.ts';
import { createEventBus, type EmittableEventName } from '#events/bus.ts';
import type { BotEvents, ListenerExtras, PluginErrorEvent } from '#events/types.ts';
import { createGroups } from '#groups/groups.ts';
import { createDeferredLogger } from '#logger/deferred.ts';
import { createLogger, createNoopLogger } from '#logger/logger.ts';
import { createSecretSet, type SecretSet } from '#logger/secrets.ts';
import type { Logger, LogLevel } from '#logger/types.ts';
import type { Message } from '#message/types.ts';
import { type ChatFilterOptions, chatAllowed, chatFilter } from '#middleware/chat-filter.ts';
import { ignoreSelf } from '#middleware/ignore-self.ts';
import { type Middleware, MiddlewarePipeline } from '#middleware/pipeline.ts';
import { type RateLimitOptions, rateLimit } from '#middleware/rate-limit.ts';
import { type SanitizeOptions, sanitize } from '#middleware/sanitize.ts';
import { createOutbound, enqueueAction } from '#outbound/actions.ts';
import {
  OutboundQueue,
  type OutboundQueueOptions,
  type OutboundQueueStats,
} from '#outbound/queue.ts';
import { PLUGIN_NAME_PATTERN } from '#plugin/define.ts';
import { createPluginHost, type PluginHost, type PluginReloadResult } from '#plugin/host.ts';
import type { PluginLifecycleError, PluginReportEntry } from '#plugin/report.ts';
import { collectPlugins } from '#plugin/sources.ts';
import type { PluginDefinition } from '#plugin/types.ts';
import { InboundQueue, type InboundQueueOptions, type InboundQueueStats } from '#queue/inbound.ts';
import { createSchedulerService } from '#scheduler/service.ts';
import { createServiceRegistry, ServiceConflictError } from '#services/registry.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { DEFAULT_SESSION, sessionStorage } from '#storage/namespace.ts';
import type { StoragePort } from '#storage/types.ts';
import { type Capability, hasCapability } from '#transport/capabilities.ts';
import type { Transport, TransportDeps } from '#transport/types.ts';
import { createUnsafeAccess } from '#unsafe/access.ts';
import {
  createMessageContext,
  type KernelMessageContext,
  type MessageContextDeps,
  messageExtras,
} from './message-context.ts';
import { CommandTimeoutError, createPluginContextFactory } from './plugin-context.ts';
import { type BotReconnectionOptions, createReconnector, type Reconnector } from './reconnect.ts';
import { claimSession, type ReleaseSession } from './session.ts';
import {
  type RegisteredStopHook,
  runStopHooks,
  type ShutdownOptions,
  type StopHook,
  type StopHookOptions,
} from './stop-hooks.ts';

/**
 * Ciclo de vida: `idle → starting → running → stopping → stopped`. `stopped` é terminal —
 * uma instância não reinicia; para subir de novo, crie outro `Bot`.
 */
export type BotState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

/** Middleware do app com prioridade (maior roda antes). */
export interface BotMiddlewareEntry {
  readonly middleware: Middleware<BotMessageContext>;
  /** Padrão: 0 — dentro dos oficiais, que ficam entre 700 e 1000. */
  readonly priority?: number;
}

/**
 * Middlewares do bot. Os oficiais entram nesta ordem (de fora para dentro): `ignoreSelf` (1000),
 * `chatFilter` (900), `rateLimit` (800), `sanitize` (700); depois os do app (`use`, padrão 0).
 */
export interface BotMiddlewaresConfig {
  /** Barra as mensagens da própria sessão. Padrão: `true`. */
  readonly ignoreSelf?: boolean;
  /** Allow/blocklist de chats. Padrão: desligado. */
  readonly chatFilter?: ChatFilterOptions;
  /** Rate limit de entrada. Padrão: desligado. Sem `onLimited`, loga em `debug`. */
  readonly rateLimit?: RateLimitOptions;
  /** Truncagem de texto e nome. Padrão: ligado com os limites do `sanitize`; `false` desliga. */
  readonly sanitize?: SanitizeOptions | false;
  /** Middlewares do app. */
  readonly use?: readonly (Middleware<BotMessageContext> | BotMiddlewareEntry)[];
}

/** Prazos dos estágios que rodam código de plugin, em ms. */
export interface BotTimeouts {
  /** Criação do contexto e `setup` de cada plugin. Padrão: 10000. */
  readonly setupMs?: number;
  /** `teardown` e limpeza de cada plugin. Padrão: 5000. */
  readonly teardownMs?: number;
  /**
   * `run` de cada comando; estourado, o chat é liberado e sai `plugin.error`. Padrão: 30000.
   * O `timeoutMs` de um comando sobrescreve só para ele.
   */
  readonly commandMs?: number;
  /** Cada listener de evento. Padrão: 30000. */
  readonly listenerMs?: number;
  /** Cada handler de job do scheduler. Padrão: 30000. */
  readonly jobMs?: number;
}

export interface BotConfig {
  /**
   * O transport, ou a fábrica que o monta com o que o bot fornece (`session`, `auth`, `log`;
   * ADR 0037). O `createBot` chama a fábrica uma vez; ela só monta o objeto, sem I/O.
   */
  readonly transport: Transport | ((deps: TransportDeps) => Transport);
  /**
   * Sessão (o número) que este bot opera; kebab-case, como nome de plugin. Tudo o que o bot
   * persiste fica no escopo dela (ADR 0036), então trocar o nome "esquece" os dados da anterior.
   * Dois bots vivos no mesmo storage não podem usar a mesma. Padrão: `'default'`.
   */
  readonly session?: string;
  /**
   * Storage do bot (plugins, scheduler, overrides de config). O bot o fecha no `stop()` — o
   * último a parar, se vários bots o dividem. Padrão: em memória (`createMemoryStorage`), com
   * aviso no log — os dados somem ao reiniciar.
   */
  readonly storage?: StoragePort;
  /** Plugins da config (pacotes npm que o app importa). */
  readonly plugins?: readonly PluginDefinition[];
  /** Pastas de plugins locais (ver `collectPlugins`), relativas a `cwd`. */
  readonly pluginDirs?: readonly string[];
  /** Base de `pluginDirs`. Padrão: `process.cwd()`. */
  readonly cwd?: string;
  /** Nomes de plugin que não carregam. */
  readonly disabledPlugins?: readonly string[];
  /** Config por plugin (a camada "arquivo"; ver ADR 0032). */
  readonly pluginConfig?: PluginConfigFile;
  /** Ambiente da config de plugin (`ZAPFORGE_*`). Padrão: `process.env`. */
  readonly env?: ConfigEnv;
  /** Telefones dos donos (`role: 'owner'`); aceitos com pontuação, normalizados no `createBot`. */
  readonly owners?: readonly string[];
  /** Prefixo de comando. Padrão: `'!'`. */
  readonly prefix?: string;
  /**
   * Logger pronto. Sem ele, o bot cria um (`createLogger`) com `logLevel` e `secrets`. Um
   * logger próprio só censura os segredos da config se for criado com o mesmo `secrets`.
   */
  readonly logger?: Logger;
  /** Nível do logger criado pelo bot. Padrão: `'info'`. */
  readonly logLevel?: LogLevel;
  /** Fonte de segredos compartilhada entre a config de plugin e o logger. Padrão: uma nova. */
  readonly secrets?: SecretSet;
  readonly middlewares?: BotMiddlewaresConfig;
  /** Fila de entrada por chat. */
  readonly inbound?: Pick<InboundQueueOptions, 'maxPendingPerChat'>;
  /** Fila de saída (taxa, prioridade, retry, humanização). */
  readonly outbound?: Omit<OutboundQueueOptions, 'transport'>;
  /** Reconexão automática. Padrão: ligada com os padrões da `ReconnectionPolicy`. */
  readonly reconnection?: BotReconnectionOptions | false;
  readonly timeouts?: BotTimeouts;
  readonly shutdown?: ShutdownOptions;
}

/** Config de plugin em runtime, para o dashboard: overrides, visão mascarada e schema. */
export type BotPluginConfigs = Pick<PluginConfigs, 'setOverrides' | 'describe' | 'jsonSchema'>;

export interface Bot {
  readonly state: BotState;
  /**
   * Sobe o bot (ordem em docs/bot.md): carrega os plugins e, só se o boot deles der certo,
   * conecta o transport e liga o scheduler. Plugin quebrado (ex.: `CommandConflictError`) ⇒ o
   * transport nunca conecta. Idempotente enquanto `starting`/`running` (devolve a mesma
   * promise); rejeita com `BotStateError` depois de `stop()`. Rejeita com o erro de boot depois
   * de encerrar o que já tinha subido.
   */
  start(): Promise<void>;
  /**
   * Shutdown gracioso: roda os ganchos de parada (LIFO; os internos drenam filas e fazem o
   * `teardown` dos plugins), desconecta o transport e fecha o storage. Idempotente: chamadas
   * repetidas devolvem a mesma promise. Rejeita com `AggregateError` se alguma etapa falhar —
   * mas sempre termina em `stopped`.
   */
  stop(): Promise<void>;
  /** Registra um gancho de parada; devolve a função que o remove. */
  onStop(hook: StopHook, options?: StopHookOptions): () => void;
  /** Config dos plugins. Disponível depois que o `start()` carrega os plugins. */
  readonly config: BotPluginConfigs;
  /** Tabela de boot atual (reflete reloads); vazia antes do `start()`. */
  plugins(): PluginReportEntry[];
  /**
   * Métricas das filas de entrada e de saída, lidas de contadores (O(1)). Sempre disponível:
   * zeros antes do `start()`, valores finais depois do `stop()`. Devolve uma cópia.
   */
  stats(): BotStats;
}

export interface BotStats {
  readonly inbound: InboundQueueStats;
  readonly outbound: OutboundQueueStats;
}

/** Operação incompatível com o estado atual do bot. */
export class BotStateError extends Error {
  readonly state: BotState;

  constructor(message: string, state: BotState) {
    super(message);
    this.name = 'BotStateError';
    this.state = state;
  }
}

/** Prazo padrão do `run` de um comando: o mesmo dos listeners. */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Prazos dos ganchos de parada internos. Somam o total padrão (`shutdown.timeoutMs`, 15 s): um
 * gancho lento não deixa os seguintes sem prazo. O que um gancho não encerrar a tempo é
 * abandonado no fim do shutdown (`abandonInternals`).
 */
const STOP_TIMEOUTS = {
  reconnection: 1000,
  inbound: 4000,
  scheduler: 2000,
  plugins: 5000,
  outbound: 3000,
} as const;

/** Eventos do transport que não são mensagem: vão ao barramento sem fila nem middlewares. */
type DirectEvent = Extract<
  EmittableEventName,
  | 'message.deleted'
  | 'reaction'
  | 'group.joined'
  | 'group.left'
  | 'group.participants'
  | 'group.updated'
  | 'contact.updated'
>;

/** O que os filtros do ADR 0038 leem de um evento; `chatId: null` = não passa pelo `chatFilter`. */
interface EventOrigin {
  readonly chatId: string | null;
  readonly fromMe: boolean;
}

const ALWAYS_PASSES: EventOrigin = { chatId: null, fromMe: false };

/** Origem de cada evento direto, para o `chatFilter` e o `ignoreSelf` (ADR 0038). */
const DIRECT_EVENTS: { readonly [E in DirectEvent]: (payload: BotEvents[E]) => EventOrigin } = {
  'message.deleted': (payload) => ({ chatId: payload.chat.id, fromMe: payload.fromMe }),
  reaction: (payload) => ({ chatId: payload.chat.id, fromMe: payload.fromMe }),
  // Entrada e saída do grupo são o ciclo de vida do próprio bot: servem para o plugin limpar
  // estado, então passam mesmo com o grupo bloqueado.
  'group.joined': () => ALWAYS_PASSES,
  'group.left': () => ALWAYS_PASSES,
  'group.participants': (payload) => ({ chatId: payload.groupId, fromMe: false }),
  'group.updated': (payload) => ({ chatId: payload.groupId, fromMe: false }),
  // Contato não é de um chat: bloquear um chat não esconde quem está nele de outros chats.
  'contact.updated': () => ALWAYS_PASSES,
};

const MIDDLEWARE_PRIORITY = { ignoreSelf: 1000, chatFilter: 900, rateLimit: 800, sanitize: 700 };

/**
 * Cria um bot. Valida a config e monta as peças sem efeito colateral (sem conexão, timer,
 * logger ou leitura de disco): o efeito começa em `start()`. Lança `BotConfigError` para
 * `owners` ou `session` malformados ou fábrica de transport que lança, e `TypeError`/`RangeError`
 * para opções inválidas.
 */
export function createBot(config: BotConfig): Bot {
  const session = validateSession(config.session ?? DEFAULT_SESSION);
  // Todo o estado vive neste closure (ADR 0004): duas instâncias nunca se enxergam.
  const hooks: RegisteredStopHook[] = [];
  let state: BotState = 'idle';
  let stopRequested = false;
  let startPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let stopAfterStart: Promise<void> | undefined;

  // O logger nasce no start(): criar o do pino aqui já seria efeito colateral. Até lá, quem
  // logar (nada deveria) cai no no-op.
  let log: Logger = createNoopLogger();
  const getLog = (): Logger => log;
  const secrets = config.secrets ?? createSecretSet();
  const storage = config.storage ?? createMemoryStorage();
  // O escopo da sessão é aplicado aqui, uma vez: scheduler, config e plugins só veem esta visão.
  const scoped = sessionStorage(storage, session);
  const auth = storage.authState(session);
  // A fábrica recebe o logger antes de ele existir: este delega ao filho `{ transport }` que o
  // start() cria e, até lá, ao no-op.
  let transportLog: Logger | undefined;
  const transport = resolveTransport(config.transport, {
    session,
    auth,
    log: createDeferredLogger(() => transportLog ?? log),
  });
  let releaseSession: ReleaseSession | undefined;
  // `connect()` já foi chamado: só então o shutdown desconecta.
  let connectCalled = false;
  // Desfaz a assinatura dos eventos do transport; existe depois que o start() a fez.
  let unsubscribe: (() => void) | undefined;
  const timeouts = config.timeouts ?? {};
  const commandTimeoutMs = timeouts.commandMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  const bus = createEventBus({
    listenerTimeoutMs: timeouts.listenerMs,
    onError: (event) => logPluginError(event),
  });
  const services = createServiceRegistry();
  const router = createCommandRouter({
    prefix: config.prefix,
    owners: normalizeOwners(config.owners ?? []),
    isGroupAdmin: groupAdminPort(transport, commandTimeoutMs, (error) =>
      log.warn('consulta de admin do grupo falhou depois do prazo', { err: error }),
    ),
    // O comando é recusado de todo jeito (fail-closed); o log diz ao autor o que falta.
    onUnknownRole: (role, command) =>
      log.error(
        `comando "${command.name}" exige o papel "${role}", que nenhum plugin carregado define: ` +
          `declare dependsOn no plugin dono do papel (em "${command.plugin}")`,
        { plugin: command.plugin, command: command.name, role },
      ),
  });
  const pipeline = createPipeline(config.middlewares ?? {}, getLog);
  // Os mesmos filtros, para os eventos que não passam pelo pipeline (ADR 0038).
  const chatFilterOptions = config.middlewares?.chatFilter;
  const chatIsAllowed = chatFilterOptions ? chatAllowed(chatFilterOptions) : () => true;
  const dropsSelf = config.middlewares?.ignoreSelf !== false;
  const inbound = new InboundQueue({
    maxPendingPerChat: config.inbound?.maxPendingPerChat,
    onError: (error, chatId) => log.error('falha ao processar mensagem', { chatId, err: error }),
  });
  const outbound = new OutboundQueue({
    onPresenceError: (error, chatId) =>
      log.debug('falha ao enviar presença', { chatId, err: error }),
    ...config.outbound,
    transport,
  });
  // O plugin vê o envio e as ações (ADR 0040): a fila (close, stats) fica com o kernel.
  const send = createOutbound(outbound, transport);
  const groups = createGroups(transport, enqueueAction(outbound, transport));
  // Cópia: o plugin recebe um `ReadonlySet`, mas um cast não deve alterar o do transport.
  const capabilities: ReadonlySet<Capability> = new Set(transport.capabilities);
  const scheduler = createSchedulerService({
    storage: scoped,
    jobTimeoutMs: timeouts.jobMs,
    onError: (event) => {
      logPluginError(event);
      void bus.emit('plugin.error', event);
    },
    onLateError: (event) => logPluginError(event),
    onStorageError: (error) => log.error('scheduler: falha no storage', { err: error }),
  });
  const contextDeps: MessageContextDeps = {
    sender: send,
    quote: hasCapability(transport, 'quoted'),
    log: getLog,
  };
  const reconnector: Reconnector | undefined =
    config.reconnection === false
      ? undefined
      : createReconnector({
          transport,
          log: getLog,
          options: {
            ...config.reconnection,
            // Com fábrica, o auth do transport é o do bot: o kernel sabe limpá-lo sozinho. Com
            // instância pronta, não sabe onde estão as credenciais.
            clearSession:
              config.reconnection?.clearSession ??
              (typeof config.transport === 'function' ? () => auth.clear() : undefined),
          },
          giveUp: () => {
            // Chamado de dentro de um handler do transport: o stop corre em paralelo.
            bot.stop().catch((error: unknown) => log.error('falha ao parar o bot', { err: error }));
          },
        });

  let host: PluginHost | undefined;
  let configs: PluginConfigs | undefined;
  let booted = false;
  // Mensagens que chegam enquanto os plugins sobem esperam aqui; `false` = boot abortado. Só a
  // primeira chamada vale: depois de pronto, o shutdown drena o que a fila já aceitou.
  let ready = false;
  let settleReady: (ok: boolean) => void = () => undefined;
  const readyPromise = new Promise<boolean>((resolve) => {
    settleReady = (ok) => {
      settleReady = () => undefined;
      ready = ok;
      resolve(ok);
    };
  });

  function logPluginError(event: PluginErrorEvent): void {
    log.error(`plugin "${event.plugin}" falhou (${event.phase})`, {
      plugin: event.plugin,
      phase: event.phase,
      event: event.event,
      timedOut: event.timedOut,
      err: event.error,
    });
  }

  /** Erros de ciclo de vida do host viram `plugin.error` (o host já os logou). */
  function emitLifecycleError(error: PluginLifecycleError): void {
    const phase = error.phase === 'context' || error.phase === 'setup' ? 'setup' : 'teardown';
    void bus.emit('plugin.error', {
      plugin: error.plugin,
      phase,
      event: null,
      error: error.cause ?? error,
      timedOut: error.timedOut,
    });
  }

  // --- Fluxo de uma mensagem (plano §5.3) -------------------------------------------------

  /**
   * Barreiras comuns à mensagem nova e à edição: espera o fim do boot e roda os middlewares em
   * volta de `handle`, que só roda se a mensagem atravessar a cadeia. A volta da cebola espera
   * `handle` terminar (ADR 0012).
   */
  async function admit(
    message: Message,
    handle: (ctx: KernelMessageContext) => Promise<void>,
  ): Promise<void> {
    if (!ready && !(await readyPromise)) return;
    await pipeline.run(createMessageContext(message, contextDeps), handle);
  }

  function handleMessage(message: Message): Promise<void> {
    return admit(message, dispatchMessage);
  }

  async function dispatchMessage(ctx: KernelMessageContext): Promise<void> {
    const { message } = ctx;
    const result = await router.dispatch(ctx);
    if (!result.consumed) {
      await bus.emit('message', message, listenerExtras(ctx));
      return;
    }
    if (result.status === 'rejected' && result.reply !== null) {
      // Sem await: a resposta espera a taxa da fila de saída, e o chat não precisa esperar.
      ctx.reply(result.reply).catch((error: unknown) =>
        ctx.log.warn('falha ao enviar a recusa do comando', {
          plugin: result.command.plugin,
          command: result.command.name,
          err: error,
        }),
      );
    } else if (result.status === 'failed') {
      const event: PluginErrorEvent = {
        plugin: result.command.plugin,
        phase: 'command',
        event: result.command.name,
        error: result.error,
        timedOut:
          result.error instanceof CommandTimeoutError ||
          result.error instanceof GroupAdminTimeoutError,
      };
      logPluginError(event);
      void bus.emit('plugin.error', event);
    }
  }

  /** Extras dos eventos de mensagem: os campos chegam aos listeners pela visão de cada plugin. */
  function listenerExtras(ctx: KernelMessageContext): ListenerExtras<'message'> {
    return messageExtras(ctx) as unknown as ListenerExtras<'message'>;
  }

  /**
   * Edição passa pelas mesmas barreiras da mensagem nova (fila do chat, boot, middlewares — o
   * `rateLimit` a conta), mas não dispara comando: só os listeners de `message.edited`.
   */
  function handleEdited(message: Message): Promise<void> {
    return admit(message, async (ctx) => {
      await bus.emit('message.edited', ctx.message, listenerExtras(ctx));
    });
  }

  /** Põe a mensagem (nova ou editada) na fila do chat dela: o mesmo chat anda em série. */
  function enqueue(message: Message, handle: (message: Message) => Promise<void>): void {
    const result = inbound.enqueue(message.chat.id, () => handle(message));
    if (result !== 'queued') {
      log.warn('mensagem descartada pela fila de entrada', {
        chatId: message.chat.id,
        messageId: message.id,
        reason: result,
      });
    }
  }

  /**
   * Repassa um evento que não é mensagem ao barramento, depois do `chatFilter` e do `ignoreSelf`
   * (ADR 0038). Durante o boot, espera os plugins subirem; sem fila do chat.
   */
  function forward<E extends DirectEvent>(event: E): () => void {
    const origin = DIRECT_EVENTS[event];
    return transport.on(event, (transportPayload) => {
      // `BotEvents` estende `TransportEvents`: o payload é o mesmo tipo.
      const payload = transportPayload as BotEvents[E];
      const { chatId, fromMe } = origin(payload);
      if ((fromMe && dropsSelf) || (chatId !== null && !chatIsAllowed(chatId))) return;
      if (ready) {
        void bus.emit(event, payload);
        return;
      }
      // Boot abortado ou `stop()` antes do fim: o evento é descartado, como a mensagem.
      void readyPromise.then((ok) => {
        if (ok) void bus.emit(event, payload);
      });
    });
  }

  /** Assina todos os eventos do transport; devolve a função que desfaz. */
  function subscribeTransport(): () => void {
    const offs: (() => void)[] = [
      transport.on('message', (message) => enqueue(message, handleMessage)),
      transport.on('message.edited', (message) => enqueue(message, handleEdited)),
      transport.on('connection.status', (status) => {
        // Com a conexão caída, o envio falharia e esgotaria o retry antes da reconexão (#198).
        if (status.status === 'closed') outbound.pause();
        else if (status.status === 'open') outbound.resume();
        reconnector?.onStatus(status);
        void bus.emit('connection.status', status);
      }),
      transport.on('connection.qr', (payload) => {
        reconnector?.onQr();
        log.info('QR de pareamento recebido', { qr: payload.qr });
        void bus.emit('connection.qr', payload);
      }),
    ];
    for (const event of Object.keys(DIRECT_EVENTS) as DirectEvent[]) offs.push(forward(event));
    return () => {
      for (const off of offs.splice(0)) off();
    };
  }

  // --- Boot ---------------------------------------------------------------------------------

  /**
   * Ganchos internos, empilhados para o LIFO rodar na ordem do shutdown (docs/bot.md). Estourado
   * o prazo, cada um abandona o que falta (o `signal` aborta) em vez de seguir em segundo plano.
   */
  function registerInternalHooks(): void {
    const push = (name: string, timeoutMs: number, hook: StopHook): void => {
      hooks.push({ name, timeoutMs, hook });
    };
    push('fila-de-saida', STOP_TIMEOUTS.outbound, (signal) => {
      // Conexão caída: o gancho do transporte já parou a reconexão, então drenar só gastaria o
      // prazo. Descarta já (ADR 0039).
      if (outbound.paused) return outbound.close({ drain: false });
      // Drena até o prazo; estourado, descarta o que aguarda (docs/outbound-queue.md).
      signal.addEventListener('abort', () => void outbound.close({ drain: false }), {
        once: true,
      });
      return outbound.close();
    });
    // Desce depois do scheduler: o teardown não corre junto com um job do próprio plugin.
    push('plugins', STOP_TIMEOUTS.plugins, async (signal) => {
      const errors = (await host?.stop(signal)) ?? [];
      if (errors.length > 0) {
        throw new AggregateError(errors, `teardown: ${errors.length} falha(s) de plugin`);
      }
    });
    push('scheduler', STOP_TIMEOUTS.scheduler, (signal) => scheduler.stop(signal));
    push('fila-de-entrada', STOP_TIMEOUTS.inbound, (signal) => {
      signal.addEventListener('abort', () => void inbound.close({ drain: false }), {
        once: true,
      });
      return inbound.close();
    });
    push('transporte', STOP_TIMEOUTS.reconnection, async () => {
      // Para de aceitar eventos (nada novo entra na fila) e de reconectar.
      unsubscribe?.();
      settleReady(false);
      await reconnector?.stop();
    });
  }

  /**
   * Passo obrigatório do shutdown, sem prazo: abandona o que os ganchos internos não encerraram
   * (estouraram o prazo, ou nem rodaram porque o prazo total acabou antes). Depois dele nenhum
   * timer do bot fica vivo e as filas estão fechadas; jobs abandonados ficam no storage e
   * disparam na próxima subida. Num shutdown limpo, não acha nada a fazer.
   */
  async function abandonInternals(): Promise<void> {
    if (unsubscribe === undefined) return;
    unsubscribe();
    settleReady(false);
    const aborted = AbortSignal.abort();
    // Sem await: o que resta delas é trabalho já em andamento, e nenhuma das três rejeita.
    void reconnector?.stop();
    void inbound.close({ drain: false });
    await scheduler.stop(aborted);
    // Teardown pulado ou abandonado vira falha que o host loga; o `dispose` roda para todos.
    await host?.stop(aborted);
    void outbound.close({ drain: false });
  }

  async function bootPlugins(): Promise<void> {
    const entries = await collectPlugins({
      plugins: config.plugins,
      pluginDirs: config.pluginDirs,
      cwd: config.cwd,
    });
    configs = createPluginConfigs({
      plugins: entries.map((entry) => entry.definition),
      file: config.pluginConfig,
      storage: scoped,
      env: config.env,
      secrets,
      log,
      reload: (name) => reload(name),
    });
    const createContext = createPluginContextFactory({
      configs,
      log,
      router,
      bus,
      services,
      storage: scoped,
      scheduler,
      send,
      groups,
      transport: {
        capabilities,
        get self() {
          return transport.self;
        },
      },
      unsafe: createUnsafeAccess({ transport, log }),
      commandTimeoutMs,
      onRoleError: (event) => {
        logPluginError(event);
        void bus.emit('plugin.error', event);
      },
      onLateCommandError: (plugin, command, error) => {
        // A recusa de um contexto expirado já foi logada quando aconteceu (ADR 0033).
        if (error instanceof ContextExpiredError) return;
        log.error(`comando "${command}" rejeitou depois do prazo`, {
          plugin,
          command,
          err: error,
        });
      },
    });
    const pluginHost = createPluginHost({
      plugins: entries,
      transport,
      createContext,
      log,
      disabledPlugins: config.disabledPlugins,
      setupTimeoutMs: timeouts.setupMs,
      teardownTimeoutMs: timeouts.teardownMs,
    });
    host = pluginHost;
    const table = await pluginHost.start();
    for (const entry of table) {
      if (entry.status !== 'skipped' || entry.reason.kind !== 'setup-failed') continue;
      const { error } = entry.reason;
      // Conflito de nome é erro no boot (ADR 0007 e 0035), não "plugin ignorado": quem
      // respondesse ao comando, papel ou serviço dependeria da ordem de carga.
      if (isBootConflict(error.cause)) throw error.cause;
      emitLifecycleError(error);
    }
  }

  async function reload(name: string): Promise<PluginReloadResult> {
    if (!host) throw new BotStateError(`reload("${name}"): plugins ainda não carregados`, state);
    const result = await host.reload(name);
    for (const error of result.errors) emitLifecycleError(error);
    // Os dependentes recarregados em cascata (ADR 0041) também podem falhar no `setup` novo.
    for (const entry of [result.entry, ...result.dependents]) {
      if (entry.status === 'skipped' && entry.reason.kind === 'setup-failed') {
        emitLifecycleError(entry.reason.error);
      }
    }
    return result;
  }

  async function runStart(): Promise<void> {
    try {
      log = config.logger ?? createLogger({ level: config.logLevel ?? 'info', secrets });
      transportLog = log.child({ transport: transport.name });
      // Antes de `booted`: um bot recusado aqui não fecha o storage do bot que usa a sessão.
      releaseSession = claimSession(storage, session);
      booted = true;
      if (config.storage === undefined) {
        log.warn('sem storage configurado: usando memória, os dados somem ao reiniciar');
      }
      unsubscribe = subscribeTransport();
      registerInternalHooks();
    } catch (error) {
      // Nada conectou ainda: só desfaz o que foi registrado.
      await shutdown().catch((cleanup: unknown) =>
        log.error('falha ao encerrar após erro no start', { err: cleanup }),
      );
      throw error;
    }

    // Plugins primeiro, connect depois (plano §5.3): um plugin quebrado (conflito de comando,
    // manifesto inválido, ciclo) derruba o boot antes de o transport abrir sessão — sem QR nem
    // handshake à toa.
    try {
      await bootPlugins();
    } catch (error) {
      log.error('falha ao carregar os plugins; encerrando', { err: error });
      // O transport nunca conectou: o encerramento não chama `disconnect()`.
      await failBoot(error);
    }

    // stop() chegou durante o boot: quem chamou stop() conduz o encerramento. Conferido também
    // antes do connect, para não abrir sessão (QR, handshake) só para fechá-la em seguida.
    const stoppedDuringBoot = (): BotStateError =>
      new BotStateError('start(): bot parado durante a inicialização', state);
    if (stopRequested) throw stoppedDuringBoot();

    // Mensagens que chegarem durante o handshake esperam na fila de entrada (`readyPromise`)
    // até o fim do boot. Conectado, uma queda já é reconectada.
    try {
      // O transport pode conectar pela metade: daqui em diante o encerramento desconecta.
      connectCalled = true;
      await callConnect(transport);
      reconnector?.activate();
    } catch (error) {
      await failBoot(error);
    }

    if (stopRequested) throw stoppedDuringBoot();
    scheduler.start();
    settleReady(true);
    state = 'running';
  }

  /** Encerra o que o boot já subiu e relança `failure` (ou o `AggregateError` com a limpeza). */
  async function failBoot(failure: unknown): Promise<never> {
    try {
      await shutdown();
    } catch (cleanupError) {
      const cleanup = cleanupError instanceof AggregateError ? cleanupError.errors : [];
      throw new AggregateError([failure, ...cleanup], 'start(): falha no boot e ao encerrar');
    }
    throw failure;
  }

  // --- Shutdown -----------------------------------------------------------------------------

  function shutdown(): Promise<void> {
    shutdownPromise ??= runShutdown();
    return shutdownPromise;
  }

  async function runShutdown(): Promise<void> {
    state = 'stopping';
    // LIFO: quem subiu por último depende de quem subiu antes, então desce primeiro.
    const errors: unknown[] = await runStopHooks(hooks.toReversed(), config.shutdown);
    hooks.length = 0;
    await abandonInternals();
    if (connectCalled) {
      try {
        await transport.disconnect();
      } catch (error) {
        errors.push(error);
      }
    }
    // Storage por último: os teardowns e o scheduler ainda o usam até aqui. Se outro bot (outra
    // sessão) ainda o usa, quem fecha é o último a parar.
    const lastUser = releaseSession?.() ?? true;
    if (booted && lastUser) {
      try {
        await storage.close();
      } catch (error) {
        errors.push(error);
      }
    }
    state = 'stopped';
    if (errors.length > 0) {
      throw new AggregateError(errors, `stop(): ${errors.length} falha(s) no encerramento`);
    }
  }

  const pluginConfigs: BotPluginConfigs = {
    setOverrides: (plugin, overrides) =>
      requireConfigs('setOverrides').setOverrides(plugin, overrides),
    describe: (plugin) => requireConfigs('describe').describe(plugin),
    jsonSchema: (plugin) => requireConfigs('jsonSchema').jsonSchema(plugin),
  };

  function requireConfigs(method: string): PluginConfigs {
    if (!configs) {
      throw new BotStateError(`config.${method}(): plugins ainda não carregados (start)`, state);
    }
    return configs;
  }

  const bot: Bot = {
    get state(): BotState {
      return state;
    },

    config: pluginConfigs,

    plugins(): PluginReportEntry[] {
      return host?.report() ?? [];
    },

    stats(): BotStats {
      return { inbound: inbound.stats(), outbound: outbound.stats() };
    },

    start(): Promise<void> {
      switch (state) {
        case 'idle':
          state = 'starting';
          startPromise = runStart();
          return startPromise;
        case 'starting':
        case 'running':
          return startPromise ?? Promise.resolve();
        default:
          return Promise.reject(
            new BotStateError(`start(): bot em "${state}" não reinicia`, state),
          );
      }
    },

    stop(): Promise<void> {
      switch (state) {
        case 'idle':
          return shutdown();
        case 'starting': {
          stopRequested = true;
          // Espera o boot assentar (sucesso ou falha) e só então encerra; se o start já
          // encerrou por falha, `shutdown` devolve a mesma promise.
          const afterStart = (): Promise<void> => shutdown();
          stopAfterStart ??= (startPromise ?? Promise.resolve()).then(afterStart, afterStart);
          return stopAfterStart;
        }
        case 'running':
          return shutdown();
        case 'stopping':
          return stopAfterStart ?? shutdownPromise ?? Promise.resolve();
        case 'stopped':
          return Promise.resolve();
      }
    },

    onStop(hook: StopHook, options: StopHookOptions = {}): () => void {
      if (state === 'stopping' || state === 'stopped') {
        throw new BotStateError(`onStop(): bot em "${state}" não aceita ganchos`, state);
      }
      const entry: RegisteredStopHook = {
        hook,
        name: options.name ?? (hook.name || 'anonimo'),
        timeoutMs: options.timeoutMs,
      };
      hooks.push(entry);
      return () => {
        const index = hooks.indexOf(entry);
        if (index !== -1) hooks.splice(index, 1);
      };
    },
  };
  return bot;
}

/** Nome de sessão no formato de nome de plugin: vira prefixo de namespace no storage. */
/** Erros de `setup` que derrubam o boot em vez de só ignorar o plugin. */
const isBootConflict = (error: unknown): boolean =>
  error instanceof CommandConflictError ||
  error instanceof RoleConflictError ||
  error instanceof ServiceConflictError;

function validateSession(session: string): string {
  if (!PLUGIN_NAME_PATTERN.test(session)) {
    throw new BotConfigError(
      `session deve ser kebab-case minúsculo (ex.: "atendimento"); recebido "${session}"`,
    );
  }
  return session;
}

/** Instância pronta, ou a que a fábrica monta; fábrica que lança é erro de config. */
function resolveTransport(transport: BotConfig['transport'], deps: TransportDeps): Transport {
  if (typeof transport !== 'function') return transport;
  try {
    return transport(deps);
  } catch (error) {
    throw new BotConfigError('transport: a fábrica lançou ao montar o transport', {
      cause: error,
    });
  }
}

/** `transport.connect()` com um throw síncrono do adapter virando rejeição. */
function callConnect(transport: Transport): Promise<void> {
  try {
    return transport.connect();
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * A consulta de admin do grupo ao transport (`role: 'group-admin'`) estourou o prazo do comando.
 * O comando não roda e sai `plugin.error` com `timedOut: true` no plugin dono do comando.
 */
export class GroupAdminTimeoutError extends Error {
  override readonly name = 'GroupAdminTimeoutError';
  readonly chatId: string;
  readonly timeoutMs: number;

  constructor(chatId: string, timeoutMs: number) {
    super(`consulta de admin do grupo "${chatId}" ao transport excedeu ${timeoutMs} ms`);
    this.chatId = chatId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Porta `isGroupAdmin` do roteador, a partir do transport (capability `groups`). Com o prazo do
 * comando: um `getGroupMetadata` que nunca resolve seguraria o chat na fila de entrada para
 * sempre. O timer só existe para quem não é owner pedindo comando de admin num grupo.
 */
function groupAdminPort(
  transport: Transport,
  timeoutMs: number,
  onLate: (error: unknown) => void,
): IsGroupAdmin | undefined {
  if (!hasCapability(transport, 'groups')) return undefined;
  return async (chatId, senderId) => {
    const metadata = (await settleWithin(
      transport.getGroupMetadata(chatId),
      timeoutMs,
      () => new GroupAdminTimeoutError(chatId, timeoutMs),
      onLate,
    )) as Awaited<ReturnType<Transport['getGroupMetadata']>>;
    return metadata.participants.some(
      (participant) => participant.id === senderId && participant.isAdmin,
    );
  };
}

/** Pipeline com os middlewares oficiais ligados pela config e os do app. */
function createPipeline(
  options: BotMiddlewaresConfig,
  log: () => Logger,
): MiddlewarePipeline<KernelMessageContext> {
  const pipeline = new MiddlewarePipeline<KernelMessageContext>();
  if (options.ignoreSelf !== false) {
    pipeline.use(ignoreSelf(), { priority: MIDDLEWARE_PRIORITY.ignoreSelf });
  }
  if (options.chatFilter) {
    pipeline.use(chatFilter(options.chatFilter), { priority: MIDDLEWARE_PRIORITY.chatFilter });
  }
  if (options.rateLimit) {
    const limit = rateLimit({
      onLimited: (ctx) =>
        log().debug('mensagem barrada pelo rate limit', {
          chatId: ctx.message.chat.id,
          senderId: ctx.message.sender.id,
        }),
      ...options.rateLimit,
    });
    pipeline.use(limit, { priority: MIDDLEWARE_PRIORITY.rateLimit });
  }
  if (options.sanitize !== false) {
    pipeline.use(sanitize(options.sanitize), { priority: MIDDLEWARE_PRIORITY.sanitize });
  }
  for (const entry of options.use ?? []) {
    if (typeof entry === 'function') pipeline.use(entry);
    else pipeline.use(entry.middleware, { priority: entry.priority });
  }
  return pipeline;
}
