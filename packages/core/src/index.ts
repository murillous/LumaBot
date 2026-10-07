// Entry `@zapforge/core` (ADR 0034): o que o autor de plugin usa e o pouco que o app usa para
// compor o bot. Peças do kernel (host, barramento, filas, scheduler, roteador) não saem daqui;
// transports e storages usam `@zapforge/core/adapter`. A lista de exports é fixada em
// `entries.test.ts`: export novo é decisão explícita.

export type {
  Bot,
  BotConfig,
  BotMiddlewareEntry,
  BotMiddlewaresConfig,
  BotPluginConfigs,
  BotState,
  BotTimeouts,
} from '#bot/bot.ts';
export { BotStateError, createBot, GroupAdminTimeoutError } from '#bot/bot.ts';
export { CommandTimeoutError } from '#bot/plugin-context.ts';
export type { BotReconnectionOptions } from '#bot/reconnect.ts';
export type { ShutdownOptions, StopHook, StopHookOptions } from '#bot/stop-hooks.ts';
export { StopHookError } from '#bot/stop-hooks.ts';
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
export { CommandConflictError } from '#commands/registry.ts';
export type { ConfigEnv } from '#config/env.ts';
export {
  type ConfigSource,
  PluginConfigError,
  type PluginConfigIssue,
} from '#config/errors.ts';
export { BotConfigError } from '#config/owners.ts';
export type {
  PluginConfigEntry,
  PluginConfigFile,
  PluginConfigJsonSchema,
  PluginConfigView,
} from '#config/plugin-configs.ts';
export { secret } from '#config/schema.ts';
export type { BotMessageContext, MessageContext } from '#context.ts';
export {
  ContextExpiredError,
  ExecutionTimeoutError,
  JobTimeoutError,
  ListenerTimeoutError,
} from '#deadline.ts';
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
export { createLogger, type LogDestination, type LoggerOptions } from '#logger/logger.ts';
export { createSecretSet, type SecretSet, type SecretSource } from '#logger/secrets.ts';
export type { LogFields, Logger, LogLevel } from '#logger/types.ts';
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
export type { Middleware, Next } from '#middleware/pipeline.ts';
export {
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
export { OutboundQueueError } from '#outbound/queue.ts';
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
export { definePlugin, PluginManifestError } from '#plugin/define.ts';
export { PluginConflictError, type PluginReloadResult } from '#plugin/host.ts';
export { PluginCycleError } from '#plugin/order.ts';
export {
  PluginLifecycleError,
  type PluginPhase,
  type PluginReportEntry,
  type PluginSkipReason,
} from '#plugin/report.ts';
export { PluginDiscoveryError } from '#plugin/sources.ts';
export type {
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginMessages,
} from '#plugin/types.ts';
export { JobHandlerConflictError } from '#scheduler/service.ts';
export type { JobContext, JobHandler, Scheduler } from '#scheduler/types.ts';
export { ServiceConflictError, ServiceNotFoundError } from '#services/registry.ts';
export type { ServiceAccess, ServiceName, Services } from '#services/types.ts';
export { createMemoryStorage } from '#storage/memory.ts';
export type {
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
export { type Capability, UnsupportedError } from '#transport/capabilities.ts';
export type {
  ConnectionStatus,
  DisconnectReason,
  GroupParticipantAction,
  MediaInput,
  MessageKey,
  OutgoingContent,
  SendOptions,
  Transport,
  Unsubscribe,
} from '#transport/types.ts';
export type { Unsafe } from '#unsafe/types.ts';
export { CORE_VERSION } from '#version.ts';
