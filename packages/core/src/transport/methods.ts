// Coerência entre as capabilities e os métodos do transport (ADR 0080). Quem escreve o adapter em
// JS não tem o compilador: sem esta checagem, o método faltando só apareceria como `TypeError` no
// meio do kernel, e a capability com erro de digitação passaria em silêncio.

import { type Capability, isCapability } from './capabilities.ts';
import type { Transport } from './types.ts';

/** Método de transport que só existe com uma capability. */
export type CapabilityMethod =
  | 'react'
  | 'edit'
  | 'delete'
  | 'sendTyping'
  | 'getGroupMetadata'
  | 'updateGroupParticipants';

// As três capabilities de participantes dividem o mesmo método.
const methods: Partial<Record<Capability, CapabilityMethod>> = {
  reactions: 'react',
  'message.edit': 'edit',
  'message.delete': 'delete',
  typing: 'sendTyping',
  groups: 'getGroupMetadata',
  'groups.add': 'updateGroupParticipants',
  'groups.remove': 'updateGroupParticipants',
  'groups.promote': 'updateGroupParticipants',
};

const isFunction = (value: unknown): boolean => typeof value === 'function';

/**
 * Problemas das capabilities: nome desconhecido ou capability sem o método dela. `implementation`
 * é o objeto onde os métodos são procurados.
 */
export function capabilityIssues(
  capabilities: Iterable<unknown>,
  implementation: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  for (const capability of capabilities) {
    if (typeof capability !== 'string' || !isCapability(capability)) {
      issues.push(`capability desconhecida ${JSON.stringify(capability)}`);
      continue;
    }
    const method = methods[capability];
    if (method !== undefined && !isFunction(implementation[method])) {
      issues.push(`declara "${capability}" mas não implementa ${method}()`);
    }
  }
  return issues;
}

const REQUIRED: readonly (keyof Transport)[] = ['connect', 'disconnect', 'on', 'send'];

/**
 * Problemas do transport que o `createBot` recebe, um por linha; lista vazia = válido. Exige só
 * os métodos das capabilities declaradas: o kernel confere a capability antes de chamar.
 */
export function transportIssues(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['o transport deve ser um objeto'];
  const transport = value as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof transport['name'] !== 'string' || transport['name'] === '') {
    issues.push('name deve ser um texto não vazio');
  }
  for (const method of REQUIRED) {
    if (!isFunction(transport[method])) issues.push(`${method} deve ser uma função`);
  }
  const capabilities = transport['capabilities'];
  if (!isSetLike(capabilities)) {
    issues.push('capabilities deve ser um Set de capabilities');
    return issues;
  }
  return [...issues, ...capabilityIssues(capabilities, transport)];
}

const isSetLike = (value: unknown): value is Iterable<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  isFunction((value as { has?: unknown }).has) &&
  isFunction((value as { [Symbol.iterator]?: unknown })[Symbol.iterator]);
