---
'@zapforge/core': minor
---

API pública por público (M1-17, ADR 0034). **Breaking:** o `@zapforge/core` deixa de exportar
peças do kernel e o que é de transport/storage passa para o novo subpath
`@zapforge/core/adapter`.

- `@zapforge/core`: API do autor de plugin e da composição do app (inalterada para quem só
  usa `definePlugin`, `command`, `secret`, `createBot`, middlewares oficiais, `createLogger`,
  `createSecretSet`, `createMemoryStorage`, tipos de contexto, mensagem, eventos e storage do
  plugin). Os tipos de transport que aparecem na API do plugin ficam nele: `MediaInput`,
  `MessageKey`, `OutgoingContent`, `SendOptions`, `ConnectionStatus`, `DisconnectReason`,
  `GroupParticipantAction`, `Unsubscribe`, além do `Capability` e do `UnsupportedError`.
- Novo `@zapforge/core/adapter`, para quem escreve transport ou storage. Saem do
  `@zapforge/core` e passam a vir dele: `createMessage`/`MessageInit`, `createMedia`/
  `MediaSource`, `TypedEmitter`/`EmitterErrorHandler`, `messageKey`, `ReconnectionPolicy` e
  seus tipos (`ReconnectionDecision`, `ReconnectionPolicyOptions`, `ReconnectionState`),
  `CAPABILITIES`, `CapabilityHolder`, `hasCapability`, `assertCapability`,
  `missingCapabilities`, `capabilitiesForSend`, `assertCanSend`, `isCapability`,
  `TransportEvents`, `TransportEventName`, `TransportEventHandler`, `GroupMetadata`,
  `GroupParticipant`, `Presence`, `AuthKeyData`, `AuthStateStore`, `StorageClosedError`,
  `normalizeQuery`, `normalizeWhere`, `normalizeDocument`, `normalizeIndexes`,
  `assertFieldName`, `cloneJson`, `FilterOperator`, `NormalizedCondition`, `NormalizedQuery`,
  `NormalizedSort`. `Transport` e `StoragePort` saem nas duas entradas.
- Deixam de ser exportados (internos do kernel, sem substituto público): `createPluginHost` e
  seus tipos e constantes (`PluginHost`, `PluginHostOptions`, `PluginHostState`,
  `PluginHostStateError`, `PluginContextFactory`, `PluginContextHandle`,
  `DEFAULT_SETUP_TIMEOUT_MS`, `DEFAULT_TEARDOWN_TIMEOUT_MS`), `createEventBus` (`EventBus`,
  `EventBusOptions`, `EmitExtras`, `EmitResult`, `EmittableEventName`,
  `DEFAULT_LISTENER_TIMEOUT_MS`), `createSchedulerService` (`SchedulerService`,
  `SchedulerServiceOptions`, `DEFAULT_JOB_TIMEOUT_MS`, `DEFAULT_STORAGE_RETRY_MS`),
  `createPluginConfigs` (`PluginConfigs`, `PluginConfigsOptions`, `ResolvedPluginConfig`),
  `createCommandRouter` (`CommandRouter`, `CommandRouterOptions`, `CommandMatch`,
  `DispatchResult`, `IsGroupAdmin`, `MatchedCommand`), `createCommandRegistry`
  (`CommandRegistry`, `RegisteredCommand`), `parseArgs`, `createServiceRegistry`
  (`ServiceRegistry`, `ProvidedService`), `createUnsafeAccess` (`UnsafeAccess`,
  `UnsafeAccessOptions`), `MiddlewarePipeline`, `MiddlewareOptions`, `RateLimiter`,
  `RateLimiterOptions`, `InboundQueue` e tipos (`InboundQueueOptions`, `InboundQueueStats`,
  `InboundTask`, `EnqueueResult`), `OutboundQueue` e tipos (`OutboundQueueOptions`,
  `OutboundQueueStats`, `OutboundTransport`, `OutboundCloseOptions`, `HumanizeOptions`,
  `RetryOptions`), `createReply`/`CreateReplyOptions`, `sortPlugins`/`OrderableManifest`,
  `satisfies`, `isValidRange`, `formatBootTable`, `describeSkipReason`, `collectPlugins`,
  `discoverPlugins`, `CollectPluginsOptions`, `PluginEntry`, `assertPluginDefinition`,
  `manifestIssues`, `PLUGIN_NAME_PATTERN`, `normalizeOwners`, `normalizePhone`, `envName`,
  `isSecretSchema`, `SECRET_MASK`, `createNoopLogger`, `MIN_SECRET_LENGTH`, `kernelStorage`,
  `pluginStorage`, `isReservedNamespace`, `ReservedNamespaceError`. O que o app configura
  dessas peças continua na config do `createBot` (`inbound`, `outbound`, `pluginDirs`,
  `owners`...).
