// Perfis de transport para o kit (ADR 0073): o que cada plataforma declara, para o teste do plugin
// rodar com as mesmas capabilities, limites e formato de contato que o transport real teria. A
// fonte é a matriz da §6.10 do plano. O `whatsapp` é o que o Baileys declara, e um teste no
// `transport-baileys` confere. Os outros são previsão até cada transport nascer.

import type { Capability, Contact, TextLimits } from '@zapforge/core';

export interface TransportProfile {
  readonly capabilities: readonly Capability[];
  /** Ausente: sem limite, como o Baileys hoje. */
  readonly limits?: TextLimits;
  /** Contato da sessão depois do `connect()`. */
  readonly self: Contact;
  /** Remetente padrão do `receive()` e do `click()`. */
  readonly sender: Contact;
}

export const DEFAULT_SELF: Contact = { id: 'bot@fake', name: 'Bot', phone: '5500000000000' };

export const DEFAULT_SENDER: Contact = {
  id: 'user@fake',
  name: 'Usuário',
  phone: '5511900000000',
};

// Capabilities que os quatro perfis têm; o resto é de cada um.
const COMMON = [
  'typing',
  'send.text',
  'send.image',
  'send.document',
  'media.download',
] as const satisfies readonly Capability[];

const whatsapp: TransportProfile = {
  capabilities: [
    ...COMMON,
    'groups',
    'groups.add',
    'groups.remove',
    'groups.promote',
    'mentions',
    'reactions',
    'send.video',
    'send.audio',
    'send.voice',
    'send.sticker',
    'message.edit',
    'message.delete',
    'polls',
    'quoted',
    'pairing',
  ],
  self: DEFAULT_SELF,
  sender: DEFAULT_SENDER,
};

const telegram: TransportProfile = {
  capabilities: [
    ...COMMON,
    'actions',
    'groups',
    'groups.remove',
    'groups.promote',
    'mentions',
    'reactions',
    'send.video',
    'send.audio',
    'send.voice',
    'send.sticker',
    'send.album',
    'message.edit',
    'message.delete',
    'polls',
    'quoted',
  ],
  limits: { text: 4096, caption: 1024, album: 10 },
  self: { id: 'bot@fake', name: 'Bot', phone: null, username: 'fake_bot', isBot: true },
  sender: { id: 'user@fake', name: 'Usuário', phone: null, username: 'usuario' },
};

const discord: TransportProfile = {
  capabilities: [
    ...COMMON,
    'actions',
    'groups',
    'groups.remove',
    'mentions',
    'reactions',
    'send.video',
    'send.audio',
    'send.album',
    'message.edit',
    'message.delete',
    'polls',
    'quoted',
  ],
  limits: { text: 2000, caption: 2000, album: 10, actions: 25 },
  self: { id: 'bot@fake', name: 'Bot', phone: null, username: 'FakeBot', isBot: true },
  sender: { id: 'user@fake', name: 'Usuário', phone: null, username: 'usuario' },
};

// Só o que a matriz confirma para o web; o que depende do #287 entra quando o transport nascer.
const web: TransportProfile = {
  capabilities: [...COMMON, 'actions'],
  self: { id: 'bot@fake', name: 'Bot', phone: null },
  sender: { id: 'user@fake', name: 'Usuário', phone: null },
};

export type ProfileName = 'whatsapp' | 'telegram' | 'discord' | 'web';

export const PROFILES: Readonly<Record<ProfileName, TransportProfile>> = {
  whatsapp,
  telegram,
  discord,
  web,
};

/** Os nomes dos perfis, para rodar o mesmo teste em todos (`describe.each(PROFILE_NAMES)`). */
export const PROFILE_NAMES: readonly ProfileName[] = ['whatsapp', 'telegram', 'discord', 'web'];
