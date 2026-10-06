// Capabilities do transporte (ADR 0010). A lista é API pública: plugins a citam em `requires`,
// então incluir é barato, mas renomear ou remover é breaking change.

import type { OutgoingContent, SendOptions } from './types.ts';

/** Capabilities iniciais (plano §6.10). */
export const CAPABILITIES = [
  'groups',
  'groups.admin',
  'mentions',
  'reactions',
  'presence',
  'send.text',
  'send.image',
  'send.video',
  'send.audio',
  'send.voice',
  'send.sticker',
  'send.document',
  'media.download',
  'message.edit',
  'message.delete',
  'polls',
  'quoted',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** O que os helpers precisam do transport: só o nome (para a mensagem de erro) e o conjunto. */
export interface CapabilityHolder {
  readonly name: string;
  readonly capabilities: ReadonlySet<Capability>;
}

const known: ReadonlySet<string> = new Set(CAPABILITIES);

/** Valida strings vindas de fora do sistema de tipos (ex.: `requires` de um manifesto em JS). */
export function isCapability(value: string): value is Capability {
  return known.has(value);
}

/**
 * Lançado quando algo usa uma capability que o transport não declarou. É a rede de segurança
 * de runtime: o caminho normal é o kernel recusar o plugin no boot via `requires`.
 */
export class UnsupportedError extends Error {
  override readonly name = 'UnsupportedError';
  readonly capability: Capability;
  readonly transport: string;

  constructor(capability: Capability, transport: string) {
    super(`O transport "${transport}" não suporta a capability "${capability}".`);
    this.capability = capability;
    this.transport = transport;
  }
}

export function hasCapability(holder: CapabilityHolder, capability: Capability): boolean {
  return holder.capabilities.has(capability);
}

export function assertCapability(holder: CapabilityHolder, capability: Capability): void {
  if (!holder.capabilities.has(capability)) {
    throw new UnsupportedError(capability, holder.name);
  }
}

/** Capabilities de `required` que o transport não declara, na ordem pedida e sem repetição. */
export function missingCapabilities(
  holder: CapabilityHolder,
  required: Iterable<Capability>,
): Capability[] {
  const missing = new Set<Capability>();
  for (const capability of required) {
    if (!holder.capabilities.has(capability)) missing.add(capability);
  }
  return [...missing];
}

const sendCapability: { readonly [K in OutgoingContent['type']]: Capability } = {
  text: 'send.text',
  image: 'send.image',
  video: 'send.video',
  audio: 'send.audio',
  voice: 'send.voice',
  sticker: 'send.sticker',
  document: 'send.document',
  poll: 'polls',
};

/** Capabilities que um envio exige: a do tipo de conteúdo, mais citação e menções se usadas. */
export function capabilitiesForSend(content: OutgoingContent, options?: SendOptions): Capability[] {
  const required: Capability[] = [sendCapability[content.type]];
  if (options?.quoted) required.push('quoted');
  if (options?.mentions && options.mentions.length > 0) required.push('mentions');
  return required;
}

/** Afirma que o transport consegue fazer o envio; lança `UnsupportedError` com a primeira falta. */
export function assertCanSend(
  holder: CapabilityHolder,
  content: OutgoingContent,
  options?: SendOptions,
): void {
  for (const capability of capabilitiesForSend(content, options)) {
    assertCapability(holder, capability);
  }
}
