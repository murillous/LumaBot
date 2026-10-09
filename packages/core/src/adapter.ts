// Entry `@zapforge/core/adapter` (ADR 0034): o que autores de transport e de storage usam além
// do modelo compartilhado (`Message`, `MessageKey`, `OutgoingContent`, tipos de storage), que
// importam de `@zapforge/core`. `Transport` e `StoragePort` saem nas duas entradas: aqui como
// contrato a implementar, lá como tipo da config do bot. A lista é fixada em `entries.test.ts`.

export { createMessage, type MessageInit } from '#message/create.ts';
export { createMedia, type MediaSource } from '#message/media.ts';
export { StorageClosedError } from '#storage/errors.ts';
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
export type { AuthKeyData, AuthStateStore, StoragePort } from '#storage/types.ts';
export {
  assertCanSend,
  assertCapability,
  CAPABILITIES,
  type CapabilityHolder,
  capabilitiesForSend,
  groupActionCapability,
  hasCapability,
  isCapability,
  missingCapabilities,
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
  ActionInteraction,
  CommandInteraction,
  GroupMetadata,
  GroupParticipant,
  Interaction,
  Transport,
  TransportCommands,
  TransportDeps,
  TransportEventHandler,
  TransportEventName,
  TransportEvents,
  TypingKind,
} from '#transport/types.ts';
