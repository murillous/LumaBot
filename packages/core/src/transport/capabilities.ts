// Capabilities do transporte (ADR 0010). A lista é API pública: plugins a citam em `requires`,
// então incluir é barato, mas renomear ou remover é breaking change.

import type { GroupParticipantAction, OutgoingContent, SendOptions } from './types.ts';

/** Capabilities iniciais (plano §6.10). */
export const CAPABILITIES = [
  'actions',
  'groups',
  'groups.add',
  'groups.remove',
  'groups.promote',
  'mentions',
  'reactions',
  // "Digitando" no chat; o status online global do WhatsApp não é do contrato (ADR 0070).
  'typing',
  'send.text',
  'send.image',
  'send.video',
  'send.audio',
  'send.voice',
  'send.sticker',
  'send.document',
  'send.album',
  'media.download',
  'message.edit',
  'message.delete',
  'polls',
  'quoted',
  // A sessão se pareia por QR ou código (`connection.qr`/`.pairing-code`): limpar as credenciais
  // leva a um pareamento novo. Sem ela, `auth-failed` para o bot em vez de limpar (ADR 0068).
  'pairing',
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

const groupCapability: { readonly [K in GroupParticipantAction]: Capability } = {
  add: 'groups.add',
  remove: 'groups.remove',
  promote: 'groups.promote',
  demote: 'groups.promote',
};

/** Capability de uma alteração de participantes; `demote` anda junto com `promote` (ADR 0059). */
export function groupActionCapability(action: GroupParticipantAction): Capability {
  return groupCapability[action];
}

const sendCapability: { readonly [K in Exclude<OutgoingContent['type'], 'album'>]: Capability } = {
  text: 'send.text',
  image: 'send.image',
  video: 'send.video',
  audio: 'send.audio',
  voice: 'send.voice',
  sticker: 'send.sticker',
  document: 'send.document',
  poll: 'polls',
};

/**
 * Capabilities que um envio exige: a do tipo de conteúdo, mais citação, menções e botões se
 * usados. O álbum exige a de cada tipo de item, e não a `send.album`: sem ela, a fila o envia
 * item a item (ADR 0065).
 */
export function capabilitiesForSend(content: OutgoingContent, options?: SendOptions): Capability[] {
  const required: Capability[] =
    content.type === 'album'
      ? [...new Set(content.items.map((item) => sendCapability[item.type]))]
      : [sendCapability[content.type]];
  if (options?.quoted) required.push('quoted');
  if (options?.mentions && options.mentions.length > 0) required.push('mentions');
  if (options?.actions && options.actions.length > 0) required.push('actions');
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
