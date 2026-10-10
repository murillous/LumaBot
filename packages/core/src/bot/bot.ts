import {
  ActionRegistry,
  type ActionTarget,
  type MessageAction,
  numberedMenu,
  pickChoice,
} from '#actions/actions.ts';
import { createCommandCatalog } from '#commands/catalog.ts';
import { createPrefixStore, type PrefixConfig } from '#commands/prefixes.ts';
import { CommandConflictError, createCommandRegistry } from '#commands/registry.ts';
import { RoleConflictError } from '#commands/roles.ts';
import { createCommandRouter, type DispatchResult, type IsGroupAdmin } from '#commands/router.ts';
import type { ConfigEnv } from '#config/env.ts';
import { BotConfigError, type BotOwner, normalizeOwners } from '#config/owners.ts';
import {
  createPluginConfigs,
  type PluginConfigFile,
  type PluginConfigs,
} from '#config/plugin-configs.ts';
import type { BotMessageContext } from '#context.ts';
import {
  ConversationRegistry,
  type PendingReply,
  StepTimeoutError,
} from '#conversations/conversations.ts';
import { ArmedTimers, ContextExpiredError, settleWithin } from '#deadline.ts';
import { createEventBus, type EmittableEventName } from '#events/bus.ts';
import type { BotEvents, ListenerExtras, PluginErrorEvent } from '#events/types.ts';
import { createGroups } from '#groups/groups.ts';
import { createDeferredLogger } from '#logger/deferred.ts';
import { createLogger, createNoopLogger } from '#logger/logger.ts';
import { createSecretSet, type SecretSet } from '#logger/secrets.ts';
import type { Logger, LogLevel } from '#logger/types.ts';
import { createMessage } from '#message/create.ts';
import type { Chat, Message } from '#message/types.ts';
import { type ChatFilterOptions, chatAllowed, chatFilter } from '#middleware/chat-filter.ts';
import { ignoreBots } from '#middleware/ignore-bots.ts';
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
import type { PrepareActions } from '#outbound/reply.ts';
import { PLUGIN_NAME_PATTERN } from '#plugin/define.ts';
import { createPluginHost, type PluginHost, type PluginReloadResult } from '#plugin/host.ts';
import type { PluginLifecycleError, PluginReportEntry } from '#plugin/report.ts';
import { collectPlugins } from '#plugin/sources.ts';
import type { PluginDefinition } from '#plugin/types.ts';
import { InboundQueue, type InboundQueueOptions, type InboundQueueStats } from '#queue/inbound.ts';
import { createSchedulerService } from '#scheduler/service.ts';
import { createServiceRegistry, ServiceConflictError } from '#services/registry.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { DEFAULT_SESSION, sessionStorage, sharedStorage } from '#storage/namespace.ts';
import type { StoragePort } from '#storage/types.ts';
import { TenantScope } from '#tenant/scope.ts';
import { type Capability, hasCapability } from '#transport/capabilities.ts';
import type {
  CommandInteraction,
  Interaction,
  Transport,
  TransportDeps,
} from '#transport/types.ts';
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
import { acquireSessionLease, type SessionLease } from './session-lease.ts';
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
 * `ignoreBots` (990), `chatFilter` (900), `rateLimit` (800), `sanitize` (700); depois os do app
 * (`use`, padrão 0).
 */
export interface BotMiddlewaresConfig {
  /** Barra as mensagens da própria sessão. Padrão: `true`. */
  readonly ignoreSelf?: boolean;
  /** Barra as mensagens de outros bots (`sender.isBot`). Padrão: `true`. */
  readonly ignoreBots?: boolean;
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
  /**
   * Cada middleware do pipeline, contado só no tempo dele (o que roda dentro do `next()` não
   * conta). Estourado, a mensagem é descartada e o erro vai para o log. Padrão: 30000.
   */
  readonly middlewareMs?: number;
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
  /**
   * Donos (`role: 'owner'`): telefone, aceito com pontuação e normalizado no `createBot`, ou
   * `{ id }` com o ID nativo do contato, para plataformas sem telefone.
   */
  readonly owners?: readonly BotOwner[];
  /**
   * Prefixo de comando: um para todo chat (`'!'`) ou um por tipo (`{ dm: '', group: '!' }`,
   * `group` vale para todo chat que não é `dm`). Vazio é permitido. Padrão: `'!'`. Um plugin
   * troca o de um chat com `ctx.prefixes.set` (ADR 0063).
   */
  readonly prefix?: PrefixConfig;
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
  /**
   * Resolve quando o bot terminou de processar o que recebeu: fila de entrada vazia, nenhum
   * listener em andamento (inclusive de eventos diretos e `plugin.error`) e fila de saída vazia,
   * as três ao mesmo tempo (ADR 0044). Chamado durante o boot, espera o boot assentar. Não
   * espera jobs do scheduler; com a fila de saída pausada (conexão caída), espera a reconexão ou
   * o `maxPauseMs`. Resolve na hora antes do `start()` e depois do `stop()`; nunca rejeita.
   */
  settled(): Promise<void>;
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

/** Prazo padrão de cada middleware: o mesmo dos handlers (ADR 0043). */
const DEFAULT_MIDDLEWARE_TIMEOUT_MS = 30_000;

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
  | 'poll.vote'
  | 'group.joined'
  | 'group.left'
  | 'group.participants'
  | 'group.updated'
  | 'contact.updated'
>;

/** O que os filtros do ADR 0038 leem de um evento; `chat: null` = não passa pelo `chatFilter`. */
interface EventOrigin {
  /** Com o `parentId`, para o `chatFilter` casar também o espaço (ADR 0058). */
  readonly chat: Pick<Chat, 'id' | 'parentId'> | null;
  readonly fromMe: boolean;
  /** Autor do evento, para o `ignoreBots` (ADR 0057). */
  readonly fromBot: boolean;
}

const ALWAYS_PASSES: EventOrigin = { chat: null, fromMe: false, fromBot: false };

/**
 * Origem de cada evento direto, para o `chatFilter`, o `ignoreSelf` e o `ignoreBots` (ADR 0038).
 */
const DIRECT_EVENTS: { readonly [E in DirectEvent]: (payload: BotEvents[E]) => EventOrigin } = {
  'message.deleted': (payload) => ({
    chat: payload.chat,
    fromMe: payload.fromMe,
    fromBot: payload.deletedBy?.isBot === true,
  }),
  reaction: (payload) => ({
    chat: payload.chat,
    fromMe: payload.fromMe,
    fromBot: payload.sender.isBot === true,
  }),
  'poll.vote': (payload) => ({
    chat: payload.chat,
    fromMe: payload.fromMe,
    fromBot: payload.sender.isBot === true,
  }),
  // Entrada e saída do grupo são o ciclo de vida do próprio bot: servem para o plugin limpar
  // estado, então passam mesmo com o grupo bloqueado.
  'group.joined': () => ALWAYS_PASSES,
  'group.left': () => ALWAYS_PASSES,
  'group.participants': (payload) => ({ chat: payload.chat, fromMe: false, fromBot: false }),
  'group.updated': (payload) => ({ chat: payload.chat, fromMe: false, fromBot: false }),
  // Contato não é de um chat: bloquear um chat não esconde quem está nele de outros chats.
  'contact.updated': () => ALWAYS_PASSES,
};

/**
 * Dono e passo da espera do menu numerado (ADR 0062). O nome não é kebab-case: nenhum plugin o
 * usa.
 */
const MENU_OWNER = '#menu';
const MENU_STEP = 'choice';

const MIDDLEWARE_PRIORITY = {
  ignoreSelf: 1000,
  ignoreBots: 990,
  chatFilter: 900,
  rateLimit: 800,
  sanitize: 700,
};

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
  // A lista de comandos que o transport registra na plataforma (ADR 0064). O registro avisa o
  // catálogo, que junta os avisos em lote.
  const catalog = createCommandCatalog({
    list: () => registry.list(),
    onError: (error) =>
      log.error('listener de commands.onChange do transport falhou', { err: error }),
  });
  const registry = createCommandRegistry({ onChange: () => catalog.changed() });
  const transport = resolveTransport(config.transport, {
    session,
    auth,
    log: createDeferredLogger(() => transportLog ?? log),
    commands: catalog.commands,
  });
  let releaseSession: ReleaseSession | undefined;
  // Trava da sessão entre processos (ADR 0074); só existe com storage que a implementa.
  let sessionLease: SessionLease | undefined;
  // O `stop()` durante o `start()` aborta a espera pela trava em vez de esperar a validade.
  const bootAbort = new AbortController();
  // `connect()` já foi chamado: só então o shutdown desconecta.
  let connectCalled = false;
  // Desfaz a assinatura dos eventos do transport; existe depois que o start() a fez.
  let unsubscribe: (() => void) | undefined;
  const timeouts = config.timeouts ?? {};
  const commandTimeoutMs = timeouts.commandMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  // Prazos de comando, papel, consulta de admin e listener: o shutdown desarma os de handlers
  // presos (`abandonInternals`).
  const armed = new ArmedTimers();
  const bus = createEventBus({
    listenerTimeoutMs: timeouts.listenerMs,
    armed,
    onError: (event) => logPluginError(event),
  });
  const services = createServiceRegistry();
  const prefixes = createPrefixStore(config.prefix, scoped);
  const router = createCommandRouter({
    registry,
    prefix: (chat) => prefixes.get(chat),
    selfUsername: () => transport.self?.username,
    owners: normalizeOwners(config.owners ?? []),
    isGroupAdmin: groupAdminPort(
      transport,
      commandTimeoutMs,
      (error) => log.warn('consulta de admin do grupo falhou depois do prazo', { err: error }),
      armed,
    ),
    // O comando é recusado de todo jeito (fail-closed); o log diz ao autor o que falta.
    onUnknownRole: (role, command) =>
      log.error(
        `comando "${command.name}" exige o papel "${role}", que nenhum plugin carregado define: ` +
          `declare dependsOn no plugin dono do papel (em "${command.plugin}")`,
        { plugin: command.plugin, command: command.name, role },
      ),
  });
  const conversations = new ConversationRegistry<KernelMessageContext>();
  // O menu numerado espera a resposta pelo mesmo registro dos plugins, então um comando digitado
  // ou outra espera também o cancelam. O passo nunca roda: o `dispatchMessage` trata a escolha.
  conversations.define(MENU_OWNER, MENU_STEP, () => undefined);
  const actions = new ActionRegistry();
  // Mensagem montada pelo kernel a partir de um clique ou comando nativo -> a interação de origem,
  // para o `ctx.unsafe.raw()` pedir ao transport o objeto bruto dela (ADR 0066). Por bot, e some
  // com a mensagem.
  const interactions = new WeakMap<Message, Interaction>();
  const buttons = hasCapability(transport, 'actions');
  const maxButtons = buttonLimit(transport);
  const pipeline = createPipeline(
    config.middlewares ?? {},
    timeouts.middlewareMs ?? DEFAULT_MIDDLEWARE_TIMEOUT_MS,
    getLog,
  );
  // Os mesmos filtros, para os eventos que não passam pelo pipeline (ADR 0038).
  const chatFilterOptions = config.middlewares?.chatFilter;
  const chatIsAllowed = chatFilterOptions ? chatAllowed(chatFilterOptions) : () => true;
  const dropsSelf = config.middlewares?.ignoreSelf !== false;
  const dropsBots = config.middlewares?.ignoreBots !== false;
  const inbound = new InboundQueue({
    maxPendingPerChat: config.inbound?.maxPendingPerChat,
    onError: (error, chatId) => log.error('falha ao processar mensagem', { chatId, err: error }),
  });
  const outbound = new OutboundQueue({
    onTypingError: (error, chatId) =>
      log.debug('falha ao enviar "digitando"', { chatId, err: error }),
    ...config.outbound,
    transport,
  });
  // O plugin vê o envio e as ações (ADR 0040): a fila (close, stats) fica com o kernel.
  const send = createOutbound(outbound, transport);
  const groups = createGroups(transport, enqueueAction(outbound, transport));
  // Cópia: o plugin recebe um `ReadonlySet`, mas um cast não deve alterar o do transport.
  const capabilities: ReadonlySet<Capability> = new Set(transport.capabilities);
  // Tenant da mensagem ou do evento em andamento (ADR 0072): o storage dos plugins e os jobs
  // agendados seguem ele.
  const tenants = new TenantScope();
  const scheduler = createSchedulerService({
    storage: scoped,
    tenants,
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
    actions: prepareActions,
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
          pairing: hasCapability(transport, 'pairing'),
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
    // A espera vem antes do roteador (ADR 0060). Retirada aqui de todo jeito: um comando digitado
    // no meio da conversa a cancela e segue para o roteador.
    const pending = conversations.take(message.chat.id, message.sender.id);
    if (pending !== undefined && router.match(message, ctx.text) === null) {
      if (pending.plugin !== MENU_OWNER) {
        await runStep(ctx, pending);
        return;
      }
      // Um número do menu roda a ação, como o clique; outro texto segue o fluxo normal (ADR 0062).
      const target = menuChoice(ctx, pending.data);
      if (target !== undefined) {
        await runAction(ctx, target);
        return;
      }
    }
    const result = await router.dispatch(ctx);
    if (!result.consumed) {
      await bus.emit('message', message, listenerExtras(ctx));
      return;
    }
    await afterCommand(ctx, result);
  }

  /** Recusa, falha e evento `command` do comando que consumiu a mensagem ou o clique. */
  async function afterCommand(
    ctx: KernelMessageContext,
    result: Extract<DispatchResult, { readonly consumed: true }>,
  ): Promise<void> {
    const { message } = ctx;
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
    // Com await, como o `message`: o observador segura o chat e entra no `settled()` (ADR 0049).
    const { plugin, name, invokedAs } = result.command;
    await bus.emit('command', { plugin, name, invokedAs, status: result.status, message });
  }

  /**
   * Roda o passo que esperava esta mensagem. Ela para aqui: não vai ao roteador, a `message` nem
   * a `command`. A falha vira `plugin.error` com `phase: 'step'`.
   */
  async function runStep(
    ctx: KernelMessageContext,
    pending: PendingReply<KernelMessageContext>,
  ): Promise<void> {
    try {
      await pending.run(ctx, pending.data);
    } catch (error) {
      const event: PluginErrorEvent = {
        plugin: pending.plugin,
        phase: 'step',
        event: pending.step,
        error,
        timedOut: error instanceof StepTimeoutError,
      };
      logPluginError(event);
      void bus.emit('plugin.error', event);
    }
  }

  // --- Ações e botões (ADR 0062) -------------------------------------------------------------

  /**
   * Resolve as ações de um `reply`: guarda o alvo de cada uma sob um ID e devolve os botões ou,
   * sem a capability ou acima do limite, o texto com o menu numerado e a espera do remetente.
   */
  function prepareActions(owner: string | null, message: Message): PrepareActions {
    return (text, list) => {
      const targets = list.map((action) => actionTarget(owner, action));
      const chatId = message.chat.id;
      const ids = targets.map((target) => actions.register(chatId, target));
      const labels = targets.map(({ label }) => label);
      if (buttons && ids.length <= maxButtons) {
        return { text, actions: ids.map((id, index) => ({ id, label: labels[index] as string })) };
      }
      conversations.expect(MENU_OWNER, chatId, message.sender.id, MENU_STEP, { data: ids });
      return { text: numberedMenu(text, labels) };
    };
  }

  /** Valida a ação e devolve o alvo: o erro sai na chamada do `reply`, não no clique. */
  function actionTarget(owner: string | null, action: MessageAction): ActionTarget {
    const label: unknown = action?.label;
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new TypeError('ação sem `label`');
    }
    if ('command' in action) {
      if (router.registry.find(action.command) === undefined) {
        throw new TypeError(`ação "${label}": comando "${action.command}" não registrado`);
      }
      return {
        kind: 'command',
        label,
        command: action.command,
        args: Object.freeze([...(action.args ?? [])]),
      };
    }
    if ('step' in action) {
      if (owner === null) {
        throw new TypeError(`ação "${label}": passo só no contexto de um plugin`);
      }
      if (conversations.find(owner, action.step) === undefined) {
        throw new TypeError(
          `ação "${label}": plugin "${owner}" sem o passo "${action.step}"; defina-o com ` +
            'ctx.conversations.define',
        );
      }
      return { kind: 'step', label, plugin: owner, step: action.step, data: action.data ?? null };
    }
    throw new TypeError(`ação "${label}" sem \`command\` nem \`step\``);
  }

  /** O alvo que a resposta ao menu numerado escolhe, se ela for um número da lista. */
  function menuChoice(ctx: KernelMessageContext, data: unknown): ActionTarget | undefined {
    const ids = data as readonly string[];
    const index = pickChoice(ctx.text, ids.length);
    if (index === null) return undefined;
    return actions.resolve(ids[index] as string, ctx.message.chat.id);
  }

  /**
   * O clique num botão: passa pela fila do chat e pelos middlewares como uma mensagem de texto com
   * o `label`, e roda o comando ou o passo da ação. Vencido, desconhecido ou de outro chat, é
   * descartado.
   */
  async function handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.command !== undefined) return handleNativeCommand(interaction);
    const { chat, sender, actionId } = interaction;
    const target = actions.resolve(actionId, chat.id);
    if (target === undefined) {
      log.debug('clique em botão vencido ou desconhecido; descartado', { chatId: chat.id });
      return;
    }
    const message = createMessage({
      type: 'text',
      id: interaction.id,
      chat,
      sender,
      text: target.label,
      timestamp: interaction.timestamp,
      fromMe: false,
    });
    interactions.set(message, interaction);
    await admit(message, async (ctx) => {
      // O clique é um comando: cancela a espera do remetente, como o comando digitado (ADR 0060).
      conversations.take(chat.id, sender.id);
      await runAction(ctx, target);
    });
  }

  /**
   * Comando nativo da plataforma (ADR 0064): roda como o clique num botão de comando, com o texto
   * livre interpretado como o que vem depois do comando digitado.
   */
  async function handleNativeCommand(interaction: CommandInteraction): Promise<void> {
    const { chat, sender, command, args } = interaction;
    const message = createMessage({
      type: 'text',
      id: interaction.id,
      chat,
      sender,
      // O texto que a plataforma mostra para o comando: quem lê a mensagem (middlewares, log) vê
      // o que a pessoa chamou.
      text: args.trim() === '' ? `/${command}` : `/${command} ${args.trimStart()}`,
      timestamp: interaction.timestamp,
      fromMe: false,
    });
    interactions.set(message, interaction);
    await admit(message, async (ctx) => {
      // Comando cancela a espera do remetente, como o digitado (ADR 0060).
      conversations.take(chat.id, sender.id);
      const result = await router.dispatch(ctx, { command, rawArgs: args });
      if (!result.consumed) {
        ctx.log.debug('comando nativo que não existe mais; descartado', { command });
        return;
      }
      await afterCommand(ctx, result);
    });
  }

  /** Roda o alvo da ação. Comando ou passo que não existe mais (plugin desligado) é descartado. */
  async function runAction(ctx: KernelMessageContext, target: ActionTarget): Promise<void> {
    if (target.kind === 'command') {
      const result = await router.dispatch(ctx, { command: target.command, args: target.args });
      if (!result.consumed) {
        ctx.log.debug('botão de comando que não existe mais; descartado', {
          command: target.command,
        });
        return;
      }
      await afterCommand(ctx, result);
      return;
    }
    const run = conversations.find(target.plugin, target.step);
    if (run === undefined) {
      ctx.log.debug('botão de passo que não existe mais; descartado', {
        plugin: target.plugin,
        step: target.step,
      });
      return;
    }
    await runStep(ctx, { plugin: target.plugin, step: target.step, data: target.data, run });
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

  /**
   * Põe a mensagem (nova ou editada) ou o clique na fila do chat dele: o mesmo chat anda em
   * série. A tarefa roda no escopo do tenant do chat (ADR 0072).
   */
  function enqueue<T extends Message | Interaction>(
    item: T,
    handle: (item: T) => Promise<void>,
  ): void {
    const result = inbound.enqueue(item.chat.id, () =>
      tenants.run(item.chat.tenantId, () => handle(item)),
    );
    if (result !== 'queued') {
      log.warn('mensagem descartada pela fila de entrada', {
        chatId: item.chat.id,
        messageId: item.id,
        reason: result,
      });
    }
  }

  /**
   * Repassa um evento que não é mensagem ao barramento, depois do `chatFilter`, do `ignoreSelf` e
   * do `ignoreBots` (ADR 0038). Durante o boot, espera os plugins subirem; sem fila do chat.
   */
  function forward<E extends DirectEvent>(event: E): () => void {
    const origin = DIRECT_EVENTS[event];
    return transport.on(event, (transportPayload) => {
      // `BotEvents` estende `TransportEvents`: o payload é o mesmo tipo.
      const payload = transportPayload as BotEvents[E];
      const { chat, fromMe, fromBot } = origin(payload);
      if ((fromMe && dropsSelf) || (fromBot && dropsBots)) return;
      if (chat !== null && !chatIsAllowed(chat)) return;
      // Os listeners rodam no escopo do tenant do chat (ADR 0072). Ele vem do payload, não da
      // origem: entrada e saída do grupo passam pelo filtro sem chat, mas são de um tenant.
      const tenant = 'chat' in payload ? payload.chat.tenantId : undefined;
      tenants.run(tenant, () => {
        if (ready) {
          void bus.emit(event, payload);
          return;
        }
        // Boot abortado ou `stop()` antes do fim: o evento é descartado, como a mensagem.
        void readyPromise.then((ok) => {
          if (ok) void bus.emit(event, payload);
        });
      });
    });
  }

  /** Assina todos os eventos do transport; devolve a função que desfaz. */
  function subscribeTransport(): () => void {
    const offs: (() => void)[] = [
      transport.on('message', (message) => enqueue(message, handleMessage)),
      transport.on('message.edited', (message) => enqueue(message, handleEdited)),
      transport.on('interaction', (interaction) => enqueue(interaction, handleInteraction)),
      transport.on('connection.status', (status) => {
        // Com a conexão caída, o envio falharia e esgotaria o retry antes da reconexão (#198).
        if (status.status === 'closed') outbound.pause();
        else if (status.status === 'open') outbound.resume();
        reconnector?.onStatus(status);
        void bus.emit('connection.status', status);
      }),
      transport.on('connection.qr', (payload) => {
        reconnector?.onQr();
        // Quem lê o log em info (agregador, arquivo) pareia o número com o QR enquanto ele vale:
        // o valor fica em debug e no barramento (`connection.qr`), para quem exibe a tela.
        log.info('QR de pareamento recebido; exiba-o pelo evento connection.qr');
        log.debug('valor do QR de pareamento', { qr: payload.qr });
        void bus.emit('connection.qr', payload);
      }),
      transport.on('connection.pairing-code', (payload) => {
        // Mesma tentativa de pareamento que o QR (ADR 0050), e o mesmo risco no log.
        reconnector?.onQr();
        log.info('código de pareamento recebido; exiba-o pelo evento connection.pairing-code');
        log.debug('valor do código de pareamento', { code: payload.code });
        void bus.emit('connection.pairing-code', payload);
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
    // Middleware preso na mensagem abandonada: sem isto, o timer dele viveria até o prazo.
    pipeline.close();
    await scheduler.stop(aborted);
    // Teardown pulado ou abandonado vira falha que o host loga; o `dispose` roda para todos.
    await host?.stop(aborted);
    // Depois do descarte dos plugins, que já expirou o `Deadline` dos handlers presos (o
    // `signal` aborta, o `reply` é recusado): sobra só o timer do prazo de cada um.
    armed.disarmAll();
    // O `dispose` de cada plugin já tirou as esperas dele; isto garante que nenhum timer de TTL
    // sobreviva ao `stop()` e que um passo atrasado não registre outra.
    conversations.close();
    actions.clear();
    void outbound.close({ drain: false });
  }

  async function bootPlugins(): Promise<void> {
    // Antes do `setup`: um plugin pode ler o prefixo do chat já no boot.
    await prefixes.load();
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
      prefixes,
      conversations,
      bus,
      services,
      storage: scoped,
      shared: sharedStorage(storage),
      tenants,
      scheduler,
      send,
      groups,
      transport: {
        name: transport.name,
        capabilities,
        get self() {
          return transport.self;
        },
      },
      unsafe: createUnsafeAccess({
        transport,
        log,
        interactionOf: (message) => interactions.get(message),
      }),
      commandTimeoutMs,
      armed,
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
    // Um aviso só ao transport, no fim: no meio, os comandos do plugin saíram e não voltaram.
    const pluginHost = host;
    const result = await catalog.batch(() => pluginHost.reload(name));
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
      // Sem conexão até o primeiro `open`: o `connect()` resolve ao iniciar a tentativa, e os
      // envios do setup e dos jobs vencidos iriam para um socket ainda fechado (ADR 0048). O
      // teto da pausa conta daqui.
      outbound.pause();
      unsubscribe = subscribeTransport();
      registerInternalHooks();
      // Antes dos plugins, que já gravam no storage e agendam jobs da sessão. Depois de assinar
      // os eventos: os que chegarem esperam a trava na fila do boot, como esperam os plugins.
      sessionLease = await acquireSessionLease({
        storage,
        session,
        log,
        signal: bootAbort.signal,
        onLost: () => {
          log.error('outro processo assumiu a trava da sessão; parando o bot', { session });
          bot.stop().catch((error: unknown) => log.error('falha ao parar o bot', { err: error }));
        },
      });
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
    // Daqui em diante, mudança na lista de comandos avisa o transport.
    catalog.open();

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
    // O teardown tira os comandos de cada plugin: o transport não deve apagar o menu da plataforma.
    catalog.close();
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
    // Liberada no stop limpo, a sessão sobe em outro processo na hora, sem esperar a validade.
    try {
      await sessionLease?.release();
    } catch (error) {
      errors.push(error);
    }
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

  /**
   * As três fontes de trabalho se realimentam (o comando envia, o envio rejeitado vira
   * `plugin.error`, o listener envia de novo): repete a espera até as três estarem ociosas na
   * mesma conferência síncrona. Só roda quando chamado: o caminho da mensagem não paga nada.
   */
  async function settled(): Promise<void> {
    // Eventos diretos que chegam no boot esperam o `readyPromise` fora do barramento.
    if (state === 'starting') await readyPromise;
    while (!(inbound.stats().activeChats === 0 && bus.idle && outbound.stats().activeChats === 0)) {
      await inbound.onIdle();
      await bus.onIdle();
      await outbound.onIdle();
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

    settled,

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
          bootAbort.abort(new BotStateError('start(): bot parado durante a inicialização', state));
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
 * Porta `isGroupAdmin` do roteador, a partir do transport: o `isChatAdmin` dele, se houver, ou a
 * lista de participantes do `getGroupMetadata` (capability `groups`, ADR 0059). Com o prazo do
 * comando: uma consulta que nunca resolve seguraria o chat na fila de entrada para sempre. O
 * timer só existe para quem não é owner pedindo comando de admin num grupo.
 */
function groupAdminPort(
  transport: Transport,
  timeoutMs: number,
  onLate: (error: unknown) => void,
  armed: ArmedTimers,
): IsGroupAdmin | undefined {
  const within = <T>(work: Promise<T>, chatId: string): Promise<T> =>
    settleWithin(
      work,
      timeoutMs,
      () => new GroupAdminTimeoutError(chatId, timeoutMs),
      onLate,
      armed,
    ) as Promise<T>;
  if (transport.isChatAdmin) {
    const isChatAdmin = transport.isChatAdmin.bind(transport);
    return (chat, sender) => within(isChatAdmin(chat, sender), chat.id);
  }
  if (!hasCapability(transport, 'groups')) return undefined;
  return async (chat, sender) => {
    const metadata = await within(transport.getGroupMetadata(chat.id), chat.id);
    // Sem a lista, não há como saber: recusa (fail-closed). Transport que não lista membros
    // deve implementar `isChatAdmin`.
    if (!metadata.participants) return false;
    // Casa por id ou, quando os dois lados o têm, por telefone: o remetente e o participante
    // podem vir com IDs de espaços diferentes (no WhatsApp, LID e JID de telefone; ADR 0046).
    // Sem telefone de um lado, só o id decide (fail-closed).
    return metadata.participants.some(
      (participant) =>
        participant.isAdmin &&
        (participant.id === sender.id ||
          (sender.phone !== null && participant.phone === sender.phone)),
    );
  };
}

/** Máximo de botões por mensagem do transport (`limits.actions`); sem ele, sem limite. */
function buttonLimit(transport: Transport): number {
  const limit = transport.limits?.actions;
  if (limit === undefined) return Number.POSITIVE_INFINITY;
  if (!(Number.isInteger(limit) && limit >= 1)) {
    throw new RangeError(`limits.actions do transport deve ser inteiro >= 1 (recebido: ${limit})`);
  }
  return limit;
}

/** Pipeline com os middlewares oficiais ligados pela config e os do app. */
function createPipeline(
  options: BotMiddlewaresConfig,
  timeoutMs: number,
  log: () => Logger,
): MiddlewarePipeline<KernelMessageContext> {
  // Middleware roda dentro da tarefa da fila do chat: sem prazo, um preso seguraria o chat
  // para sempre (ADR 0043).
  const pipeline = new MiddlewarePipeline<KernelMessageContext>({
    timeoutMs,
    onLateError: (error) => log().error('middleware rejeitou depois do prazo', { err: error }),
  });
  if (options.ignoreSelf !== false) {
    pipeline.use(ignoreSelf(), { priority: MIDDLEWARE_PRIORITY.ignoreSelf });
  }
  if (options.ignoreBots !== false) {
    pipeline.use(ignoreBots(), { priority: MIDDLEWARE_PRIORITY.ignoreBots });
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
