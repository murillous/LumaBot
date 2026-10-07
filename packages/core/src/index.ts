export type {
  Bot,
  BotConfig,
  BotMiddlewareEntry,
  BotMiddlewaresConfig,
  BotPluginConfigs,
  BotState,
  BotTimeouts,
} from '#bot/bot.ts';
export { BotStateError, createBot } from '#bot/bot.ts';
export { CommandTimeoutError } from '#bot/plugin-context.ts';
export type { BotReconnectionOptions } from '#bot/reconnect.ts';
export type { ShutdownOptions, StopHook, StopHookOptions } from '#bot/stop-hooks.ts';
export { StopHookError } from '#bot/stop-hooks.ts';
export { parseArgs } from '#commands/args.ts';
export type {
  AcceptedMessage,
  AcceptSpec,
  CommandContext,
  CommandDefinition,
  CommandRejection,
  CommandRole,
  RejectContext,
} from '#commands/command.ts';
export { command } from '#commands/command.ts';
export type { CommandRegistry, RegisteredCommand } from '#commands/registry.ts';
export { CommandConflictError, createCommandRegistry } from '#commands/registry.ts';
export type {
  CommandMatch,
  CommandRouter,
  CommandRouterOptions,
  DispatchResult,
  IsGroupAdmin,
  MatchedCommand,
} from '#commands/router.ts';
export { createCommandRouter } from '#commands/router.ts';
export { type ConfigEnv, envName } from '#config/env.ts';
export {
  type ConfigSource,
  PluginConfigError,
  type PluginConfigIssue,
} from '#config/errors.ts';
export { BotConfigError, normalizeOwners, normalizePhone } from '#config/owners.ts';
export {
  createPluginConfigs,
  type PluginConfigEntry,
  type PluginConfigFile,
  type PluginConfigJsonSchema,
  type PluginConfigs,
  type PluginConfigsOptions,
  type PluginConfigView,
  type ResolvedPluginConfig,
} from '#config/plugin-configs.ts';
export { isSecretSchema, SECRET_MASK, secret } from '#config/schema.ts';
export type { BotMessageContext, MessageContext } from '#context.ts';
export { ContextExpiredError } from '#deadline.ts';
export {
  createEventBus,
  DEFAULT_LISTENER_TIMEOUT_MS,
  type EmitExtras,
  type EmitResult,
  type EmittableEventName,
  type EventBus,
  type EventBusOptions,
} from '#events/bus.ts';
// Contratos do M1-7 a M1-15 (implementações nos PRs de cada item).
export type {
  BaseListenerContext,
  BotEventName,
  BotEvents,
  EventSubscriber,
  Listener,
  ListenerContext,
  ListenerExtras,
  ListenerOptions,
  MessageFilter,
  MessageListenerFields,
  MessageTypeEvents,
  PluginErrorEvent,
  SubscribeOptions,
} from '#events/types.ts';
export {
  createLogger,
  createNoopLogger,
  type LogDestination,
  type LoggerOptions,
} from '#logger/logger.ts';
export { createSecretSet, type SecretSet, type SecretSource } from '#logger/secrets.ts';
export type { LogFields, Logger, LogLevel } from '#logger/types.ts';
export { createMessage, type MessageInit } from '#message/create.ts';
export { createMedia, type MediaSource } from '#message/media.ts';
export type {
  AudioMessage,
  Chat,
  Contact,
  ContactMessage,
  DocumentMessage,
  ImageMessage,
  LocationMessage,
  Media,
  MediaMessageType,
  Message,
  MessageOf,
  MessageType,
  PollMessage,
  StickerMessage,
  TextMessage,
  UnknownMessage,
  VideoMessage,
  VoiceMessage,
} from '#message/types.ts';
export { type ChatFilterOptions, chatFilter } from '#middleware/chat-filter.ts';
export { ignoreSelf } from '#middleware/ignore-self.ts';
export {
  type Middleware,
  type MiddlewareOptions,
  MiddlewarePipeline,
  type Next,
} from '#middleware/pipeline.ts';
export {
  RateLimiter,
  type RateLimiterOptions,
  type RateLimitOptions,
  type RateLimitScope,
  rateLimit,
} from '#middleware/rate-limit.ts';
export {
  type SanitizedContext,
  type SanitizedFields,
  type SanitizeOptions,
  sanitize,
} from '#middleware/sanitize.ts';
export {
  type HumanizeOptions,
  type OutboundCloseOptions,
  OutboundQueue,
  OutboundQueueError,
  type OutboundQueueOptions,
  type OutboundQueueStats,
  type OutboundTransport,
  type RetryOptions,
} from '#outbound/queue.ts';
export { type CreateReplyOptions, createReply } from '#outbound/reply.ts';
export type {
  OutboundSendOptions,
  Reply,
  ReplyAudioOptions,
  ReplyDocumentOptions,
  ReplyMediaOptions,
  ReplyOptions,
  ReplyPollOptions,
  Sender,
  SendPriority,
} from '#outbound/types.ts';
export {
  assertPluginDefinition,
  definePlugin,
  manifestIssues,
  PLUGIN_NAME_PATTERN,
  PluginManifestError,
} from '#plugin/define.ts';
export {
  createPluginHost,
  DEFAULT_SETUP_TIMEOUT_MS,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  PluginConflictError,
  type PluginContextFactory,
  type PluginContextHandle,
  type PluginHost,
  type PluginHostOptions,
  type PluginHostState,
  PluginHostStateError,
  type PluginReloadResult,
} from '#plugin/host.ts';
export { type OrderableManifest, PluginCycleError, sortPlugins } from '#plugin/order.ts';
export {
  describeSkipReason,
  formatBootTable,
  PluginLifecycleError,
  type PluginPhase,
  type PluginReportEntry,
  type PluginSkipReason,
} from '#plugin/report.ts';
export { isValidRange, satisfies } from '#plugin/semver.ts';
export {
  type CollectPluginsOptions,
  collectPlugins,
  discoverPlugins,
  PluginDiscoveryError,
  type PluginEntry,
} from '#plugin/sources.ts';
export type {
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginMessages,
} from '#plugin/types.ts';
export type {
  EnqueueResult,
  InboundQueueOptions,
  InboundQueueStats,
  InboundTask,
} from '#queue/inbound.ts';
export { InboundQueue } from '#queue/inbound.ts';
export {
  createSchedulerService,
  DEFAULT_JOB_TIMEOUT_MS,
  DEFAULT_STORAGE_RETRY_MS,
  JobHandlerConflictError,
  type SchedulerService,
  type SchedulerServiceOptions,
} from '#scheduler/service.ts';
export type { JobContext, JobHandler, Scheduler } from '#scheduler/types.ts';
export type { ProvidedService, ServiceRegistry } from '#services/registry.ts';
export {
  createServiceRegistry,
  ServiceConflictError,
  ServiceNotFoundError,
} from '#services/registry.ts';
export type { ServiceAccess, ServiceName, Services } from '#services/types.ts';
export { ReservedNamespaceError, StorageClosedError } from '#storage/errors.ts';
export { createMemoryStorage } from '#storage/memory.ts';
export { isReservedNamespace, kernelStorage, pluginStorage } from '#storage/namespace.ts';
export {
  assertFieldName,
  cloneJson,
  type FilterOperator,
  type NormalizedCondition,
  type NormalizedQuery,
  type NormalizedSort,
  normalizeDocument,
  normalizeIndexes,
  normalizeQuery,
  normalizeWhere,
} from '#storage/query.ts';
export type {
  AuthKeyData,
  AuthStateStore,
  Collection,
  CollectionOptions,
  FieldCondition,
  FieldName,
  FieldOperators,
  FindQuery,
  JsonObject,
  JsonValue,
  KeyValueStore,
  Patch,
  PluginStorage,
  Scalar,
  Sort,
  SortDirection,
  StoragePort,
  Target,
  Where,
  WithId,
} from '#storage/types.ts';
export {
  assertCanSend,
  assertCapability,
  CAPABILITIES,
  type Capability,
  type CapabilityHolder,
  capabilitiesForSend,
  hasCapability,
  isCapability,
  missingCapabilities,
  UnsupportedError,
} from '#transport/capabilities.ts';
export { type EmitterErrorHandler, TypedEmitter } from '#transport/emitter.ts';
export { messageKey } from '#transport/message-key.ts';
export {
  type ReconnectionDecision,
  ReconnectionPolicy,
  type ReconnectionPolicyOptions,
  type ReconnectionState,
} from '#transport/reconnection.ts';
export type {
  ConnectionStatus,
  DisconnectReason,
  GroupMetadata,
  GroupParticipant,
  GroupParticipantAction,
  MediaInput,
  MessageKey,
  OutgoingContent,
  Presence,
  SendOptions,
  Transport,
  TransportEventHandler,
  TransportEventName,
  TransportEvents,
  Unsubscribe,
} from '#transport/types.ts';
export {
  createUnsafeAccess,
  type UnsafeAccess,
  type UnsafeAccessOptions,
} from '#unsafe/access.ts';
export type { Unsafe } from '#unsafe/types.ts';
export { CORE_VERSION } from '#version.ts';
