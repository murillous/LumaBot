export type { Bot, BotConfig, BotState } from '#bot/bot.ts';
export { BotStateError, createBot } from '#bot/bot.ts';
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
export type { MessageContext } from '#context.ts';
// Contratos do M1-7 a M1-15 (implementações nos PRs de cada item).
export type {
  BotEventName,
  BotEvents,
  EventSubscriber,
  Listener,
  ListenerContext,
  ListenerOptions,
  MessageTypeEvents,
  PluginErrorEvent,
} from '#events/types.ts';
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
export type { OutboundSendOptions, Sender, SendPriority } from '#outbound/types.ts';
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
export type { JobHandler, Scheduler } from '#scheduler/types.ts';
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
export type { Unsafe } from '#unsafe/types.ts';
