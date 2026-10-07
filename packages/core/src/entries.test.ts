import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ADR 0034: cada ponto de entrada tem um público, e o que sai dele fica preso ao ciclo de
// depreciação depois da 1.0 (ADR 0027). As listas abaixo são a API pública: export novo (ou
// removido) só passa editando-as, como decisão explícita, nunca por `vitest -u`.

interface EntryExports {
  readonly values: readonly string[];
  readonly types: readonly string[];
}

const entries: Record<string, { file: string; load: () => Promise<object> } & EntryExports> = {
  '@zapforge/core': {
    file: './index.ts',
    load: () => import('@zapforge/core'),
    values: [
      'BotConfigError',
      'BotStateError',
      'CORE_VERSION',
      'CommandConflictError',
      'CommandTimeoutError',
      'ContextExpiredError',
      'ExecutionTimeoutError',
      'JobHandlerConflictError',
      'JobTimeoutError',
      'ListenerTimeoutError',
      'OutboundQueueError',
      'PluginConfigError',
      'PluginConflictError',
      'PluginCycleError',
      'PluginDiscoveryError',
      'PluginLifecycleError',
      'PluginManifestError',
      'ServiceConflictError',
      'ServiceNotFoundError',
      'StopHookError',
      'UnsupportedError',
      'chatFilter',
      'command',
      'createBot',
      'createLogger',
      'createMemoryStorage',
      'createSecretSet',
      'definePlugin',
      'ignoreSelf',
      'rateLimit',
      'sanitize',
      'secret',
    ],
    types: [
      'AcceptSpec',
      'AcceptedMessage',
      'AudioMessage',
      'BaseListenerContext',
      'Bot',
      'BotConfig',
      'BotEventName',
      'BotEvents',
      'BotMessageContext',
      'BotMiddlewareEntry',
      'BotMiddlewaresConfig',
      'BotPluginConfigs',
      'BotReconnectionOptions',
      'BotState',
      'BotTimeouts',
      'Capability',
      'Chat',
      'ChatFilterOptions',
      'Collection',
      'CollectionOptions',
      'CommandContext',
      'CommandDefinition',
      'CommandRejection',
      'CommandRole',
      'ConfigEnv',
      'ConfigSource',
      'ConnectionStatus',
      'Contact',
      'ContactMessage',
      'DisconnectReason',
      'DocumentMessage',
      'EventSubscriber',
      'FieldCondition',
      'FieldName',
      'FieldOperators',
      'FindQuery',
      'GroupParticipantAction',
      'ImageMessage',
      'JobContext',
      'JobHandler',
      'JsonObject',
      'JsonValue',
      'KeyValueStore',
      'Listener',
      'ListenerContext',
      'ListenerExtras',
      'ListenerOptions',
      'LocationMessage',
      'LogDestination',
      'LogFields',
      'LogLevel',
      'Logger',
      'LoggerOptions',
      'Media',
      'MediaInput',
      'MediaMessageType',
      'Message',
      'MessageContext',
      'MessageFilter',
      'MessageKey',
      'MessageListenerFields',
      'MessageOf',
      'MessageType',
      'MessageTypeEvents',
      'Middleware',
      'Next',
      'OutboundSendOptions',
      'OutgoingContent',
      'Patch',
      'PluginConfigEntry',
      'PluginConfigFile',
      'PluginConfigIssue',
      'PluginConfigJsonSchema',
      'PluginConfigView',
      'PluginContext',
      'PluginDefinition',
      'PluginErrorEvent',
      'PluginManifest',
      'PluginMessages',
      'PluginPhase',
      'PluginReloadResult',
      'PluginReportEntry',
      'PluginSkipReason',
      'PluginStorage',
      'PollMessage',
      'RateLimitOptions',
      'RateLimitScope',
      'RejectContext',
      'Reply',
      'ReplyAudioOptions',
      'ReplyDocumentOptions',
      'ReplyMediaOptions',
      'ReplyOptions',
      'ReplyPollOptions',
      'SanitizeOptions',
      'SanitizedContext',
      'SanitizedFields',
      'Scalar',
      'Scheduler',
      'SecretSet',
      'SecretSource',
      'SendOptions',
      'SendPriority',
      'Sender',
      'ServiceAccess',
      'ServiceName',
      'Services',
      'ShutdownOptions',
      'Sort',
      'SortDirection',
      'StickerMessage',
      'StopHook',
      'StopHookOptions',
      'StoragePort',
      'SubscribeOptions',
      'Target',
      'TextMessage',
      'Transport',
      'UnknownMessage',
      'Unsafe',
      'Unsubscribe',
      'VideoMessage',
      'VoiceMessage',
      'Where',
      'WithId',
    ],
  },
  '@zapforge/core/adapter': {
    file: './adapter.ts',
    load: () => import('@zapforge/core/adapter'),
    values: [
      'CAPABILITIES',
      'ReconnectionPolicy',
      'StorageClosedError',
      'TypedEmitter',
      'assertCanSend',
      'assertCapability',
      'assertFieldName',
      'capabilitiesForSend',
      'cloneJson',
      'createMedia',
      'createMessage',
      'hasCapability',
      'isCapability',
      'messageKey',
      'missingCapabilities',
      'normalizeDocument',
      'normalizeIndexes',
      'normalizeQuery',
      'normalizeWhere',
    ],
    types: [
      'AuthKeyData',
      'AuthStateStore',
      'CapabilityHolder',
      'EmitterErrorHandler',
      'FilterOperator',
      'GroupMetadata',
      'GroupParticipant',
      'MediaSource',
      'MessageInit',
      'NormalizedCondition',
      'NormalizedQuery',
      'NormalizedSort',
      'Presence',
      'ReconnectionDecision',
      'ReconnectionPolicyOptions',
      'ReconnectionState',
      'StoragePort',
      'Transport',
      'TransportEventHandler',
      'TransportEventName',
      'TransportEvents',
    ],
  },
  '@zapforge/core/storage-contract': {
    file: './storage/contract/index.ts',
    load: () => import('@zapforge/core/storage-contract'),
    values: ['defineStorageContract'],
    types: ['ContractTestApi', 'StorageContractOptions'],
  },
};

// Tipos somem em runtime, então a lista deles sai do texto do entry. Os entries só reexportam
// (`export { ... } from` e `export type { ... } from`), o que um regex lê sem ambiguidade; a
// comparação com o módulo carregado pega qualquer outra forma de export que escape dele.
function declaredExports(file: string): EntryExports {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8');
  const values: string[] = [];
  const types: string[] = [];
  for (const [, typeOnly, list = ''] of code.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const raw of list.split(',')) {
      const name = raw.trim();
      if (name === '') continue;
      if (typeOnly !== undefined || name.startsWith('type '))
        types.push(name.replace(/^type\s+/, ''));
      else values.push(name);
    }
  }
  for (const [, name = ''] of code.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g,
  )) {
    values.push(name);
  }
  return { values: values.sort(), types: types.sort() };
}

describe.each(Object.entries(entries))('%s', (_name, entry) => {
  it('exporta exatamente os valores da lista', async () => {
    const module = await entry.load();
    expect(Object.keys(module).sort()).toEqual([...entry.values].sort());
    expect(declaredExports(entry.file).values).toEqual([...entry.values].sort());
  });

  it('exporta exatamente os tipos da lista', () => {
    expect(declaredExports(entry.file).types).toEqual([...entry.types].sort());
  });
});

it('peças do kernel não saem em nenhum ponto de entrada', () => {
  const kernel = [
    'createPluginHost',
    'createEventBus',
    'createSchedulerService',
    'createPluginConfigs',
    'createCommandRouter',
    'createServiceRegistry',
    'createUnsafeAccess',
    'MiddlewarePipeline',
    'InboundQueue',
    'OutboundQueue',
    'sortPlugins',
    'collectPlugins',
  ];
  const exported = Object.values(entries).flatMap((entry) => [...entry.values, ...entry.types]);
  expect(exported.filter((name) => kernel.includes(name))).toEqual([]);
});
