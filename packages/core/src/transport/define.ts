// Açúcar para o autor de transport (ADR 0080). O adapter descreve só o que é dele (conectar,
// enviar, os métodos das capabilities que declara), e `defineTransport` monta o `Transport`
// completo: emissor, `on()`, `self`, a checagem de capability e o `UnsupportedError` do resto.

import type { Chat, Contact, Message } from '#message/types.ts';
import {
  assertCanSend,
  assertCapability,
  type Capability,
  groupActionCapability,
  UnsupportedError,
} from './capabilities.ts';
import { TypedEmitter } from './emitter.ts';
import { type CapabilityMethod, capabilityIssues } from './methods.ts';
import type {
  Interaction,
  TextLimits,
  Transport,
  TransportDeps,
  TransportEventName,
  TransportEvents,
  TransportPacing,
} from './types.ts';

/** O que `defineTransport` entrega ao adapter, além das `TransportDeps`. */
export interface TransportKit {
  /** Entrega um evento ao kernel. Erro de handler vai para o log, nunca para o adapter. */
  emit<E extends TransportEventName>(event: E, payload: TransportEvents[E]): void;
  /** Contato da própria sessão, lido em `Transport.self`. Chame ao abrir a conexão. */
  setSelf(contact: Contact | null): void;
}

/**
 * O transport como o adapter o descreve: o contrato `Transport` sem o que `defineTransport`
 * monta (`on`, `self`), com `capabilities` em lista e os métodos de capability opcionais.
 */
export interface TransportSpec
  extends Pick<Transport, 'connect' | 'disconnect' | 'send'>,
    Partial<Pick<Transport, CapabilityMethod | 'raw' | 'isChatAdmin'>> {
  readonly name: string;
  readonly capabilities: readonly Capability[];
  readonly native?: unknown;
  readonly limits?: TextLimits;
  readonly pacing?: TransportPacing;
}

/** Problemas da descrição, um por linha; lista vazia = válida. */
export function transportSpecIssues(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) {
    return ['a função do defineTransport deve devolver um objeto'];
  }
  const spec = value as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof spec['name'] !== 'string' || spec['name'] === '') {
    issues.push('name deve ser um texto não vazio');
  }
  for (const method of ['connect', 'disconnect', 'send']) {
    if (typeof spec[method] !== 'function') issues.push(`${method} deve ser uma função`);
  }
  const capabilities = spec['capabilities'];
  if (!Array.isArray(capabilities)) {
    issues.push('capabilities deve ser uma lista (ex.: ["send.text"])');
    return issues;
  }
  return [...issues, ...capabilityIssues(capabilities, spec)];
}

/**
 * Monta a fábrica do transport (ADR 0037) a partir da descrição que `build` devolve. A descrição
 * inválida lança `TypeError` com todos os problemas, e o `createBot` a converte em
 * `BotConfigError`. Cada método confere a capability antes de chamar o do adapter; o que ele não
 * implementa rejeita com `UnsupportedError`.
 */
export function defineTransport(
  build: (deps: TransportDeps, kit: TransportKit) => TransportSpec,
): (deps: TransportDeps) => Transport {
  return (deps) => {
    const events = new TypedEmitter<TransportEvents>((error, event) =>
      deps.log.error('handler de evento do transport falhou', { err: error, event }),
    );
    let self: Contact | null = null;
    const spec = build(deps, {
      emit: (event, payload) => events.emit(event, payload),
      setSelf: (contact) => {
        self = contact;
      },
    });
    const issues = transportSpecIssues(spec);
    if (issues.length > 0) {
      const name = typeof spec?.name === 'string' ? `"${spec.name}" ` : '';
      throw new TypeError(`transport ${name}inválido:\n- ${issues.join('\n- ')}`);
    }
    return assemble(spec, events, () => self);
  };
}

function assemble(
  spec: TransportSpec,
  events: TypedEmitter<TransportEvents>,
  self: () => Contact | null,
): Transport {
  const capabilities: ReadonlySet<Capability> = new Set(spec.capabilities);
  const holder = { name: spec.name, capabilities };
  /** Confere a capability e chama o método do adapter; sem ele, `UnsupportedError`. */
  const gated = async <R>(
    capability: Capability,
    call: ((spec: TransportSpec) => Promise<R>) | undefined,
  ): Promise<R> => {
    assertCapability(holder, capability);
    // A coerência foi conferida na montagem: só falta o método se a capability não foi declarada.
    if (call === undefined) throw new UnsupportedError(capability, spec.name);
    return call(spec);
  };
  const { react, edit, getGroupMetadata, updateGroupParticipants, sendTyping, raw, isChatAdmin } =
    spec;
  const remove = spec.delete;
  return {
    name: spec.name,
    capabilities,
    get self() {
      return self();
    },
    native: spec.native,
    ...(spec.limits !== undefined && { limits: spec.limits }),
    ...(spec.pacing !== undefined && { pacing: spec.pacing }),
    ...(raw !== undefined && {
      raw: (source: Message | Interaction) => raw.call(spec, source),
    }),
    ...(isChatAdmin !== undefined && {
      isChatAdmin: (chat: Chat, contact: Contact) => isChatAdmin.call(spec, chat, contact),
    }),
    connect: () => spec.connect(),
    disconnect: () => spec.disconnect(),
    on: (event, handler) => events.on(event, handler),
    send: async (chatId, content, options) => {
      assertCanSend(holder, content, options);
      return spec.send(chatId, content, options);
    },
    react: (key, emoji) => gated('reactions', react && ((s) => react.call(s, key, emoji))),
    edit: (key, text, formatted) =>
      gated('message.edit', edit && ((s) => edit.call(s, key, text, formatted))),
    delete: (key) => gated('message.delete', remove && ((s) => remove.call(s, key))),
    sendTyping: (chatId, kind) =>
      gated('typing', sendTyping && ((s) => sendTyping.call(s, chatId, kind))),
    getGroupMetadata: (groupId) =>
      gated('groups', getGroupMetadata && ((s) => getGroupMetadata.call(s, groupId))),
    updateGroupParticipants: (groupId, participantIds, action) =>
      gated(
        groupActionCapability(action),
        updateGroupParticipants &&
          ((s) => updateGroupParticipants.call(s, groupId, participantIds, action)),
      ),
  };
}
