import { describe, expect, it } from 'vitest';
import {
  assertCanSend,
  assertCapability,
  CAPABILITIES,
  type CapabilityHolder,
  capabilitiesForSend,
  groupActionCapability,
  hasCapability,
  isCapability,
  missingCapabilities,
  UnsupportedError,
} from './capabilities.ts';
import { textMessage } from './fake-transport.test-support.ts';

const holder: CapabilityHolder = {
  name: 'parcial',
  capabilities: new Set(['send.text', 'groups', 'reactions']),
};

describe('CAPABILITIES', () => {
  it('lista as capabilities iniciais do plano §6.10, sem repetição', () => {
    expect(CAPABILITIES).toHaveLength(20);
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it('isCapability valida strings de fora do sistema de tipos', () => {
    expect(isCapability('send.sticker')).toBe(true);
    expect(isCapability('send.hologram')).toBe(false);
  });
});

describe('hasCapability / assertCapability', () => {
  it('reflete o conjunto declarado', () => {
    expect(hasCapability(holder, 'groups')).toBe(true);
    expect(hasCapability(holder, 'groups.add')).toBe(false);
  });

  it('assertCapability lança UnsupportedError com a capability e o transport', () => {
    expect(() => assertCapability(holder, 'groups')).not.toThrow();

    let caught: unknown;
    try {
      assertCapability(holder, 'polls');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedError);
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({
      name: 'UnsupportedError',
      capability: 'polls',
      transport: 'parcial',
    });
    expect((caught as Error).message).toContain('polls');
  });
});

describe('missingCapabilities', () => {
  it('devolve só as faltantes, na ordem pedida e sem repetição', () => {
    expect(missingCapabilities(holder, ['polls', 'groups', 'mentions', 'polls'])).toEqual([
      'polls',
      'mentions',
    ]);
  });

  it('lista vazia quando tudo é suportado', () => {
    expect(missingCapabilities(holder, ['send.text', 'groups'])).toEqual([]);
  });
});

describe('capabilitiesForSend / assertCanSend', () => {
  it('mapeia cada tipo de conteúdo para a sua capability', () => {
    const media = Buffer.from('x');
    expect(capabilitiesForSend({ type: 'text', text: 'oi' })).toEqual(['send.text']);
    expect(capabilitiesForSend({ type: 'image', media })).toEqual(['send.image']);
    expect(capabilitiesForSend({ type: 'video', media })).toEqual(['send.video']);
    expect(capabilitiesForSend({ type: 'audio', media })).toEqual(['send.audio']);
    expect(capabilitiesForSend({ type: 'voice', media })).toEqual(['send.voice']);
    expect(capabilitiesForSend({ type: 'sticker', media: { url: 'https://x' } })).toEqual([
      'send.sticker',
    ]);
    expect(
      capabilitiesForSend({
        type: 'document',
        media,
        fileName: 'a.pdf',
        mimetype: 'application/pdf',
      }),
    ).toEqual(['send.document']);
    expect(capabilitiesForSend({ type: 'poll', name: 'q', options: ['a', 'b'] })).toEqual([
      'polls',
    ]);
  });

  it('acrescenta quoted e mentions quando usados; menções vazias não exigem nada', () => {
    const quoted = textMessage('original');
    expect(capabilitiesForSend({ type: 'text', text: 'oi' }, { quoted, mentions: ['a'] })).toEqual([
      'send.text',
      'quoted',
      'mentions',
    ]);
    expect(capabilitiesForSend({ type: 'text', text: 'oi' }, { mentions: [] })).toEqual([
      'send.text',
    ]);
  });

  it('botões exigem `actions`; lista vazia não exige nada (ADR 0062)', () => {
    const actions = [{ id: 'a1', label: 'Notas' }];
    expect(capabilitiesForSend({ type: 'text', text: 'oi' }, { actions })).toEqual([
      'send.text',
      'actions',
    ]);
    expect(capabilitiesForSend({ type: 'text', text: 'oi' }, { actions: [] })).toEqual([
      'send.text',
    ]);
  });

  it('assertCanSend lança na primeira capability faltante', () => {
    expect(() => assertCanSend(holder, { type: 'text', text: 'oi' })).not.toThrow();
    expect(() =>
      assertCanSend(holder, { type: 'text', text: 'oi' }, { quoted: textMessage('x') }),
    ).toThrow(expect.objectContaining({ capability: 'quoted' }));
    expect(() => assertCanSend(holder, { type: 'sticker', media: Buffer.from('x') })).toThrow(
      UnsupportedError,
    );
  });
});

describe('groupActionCapability', () => {
  it('mapeia cada ação; demote usa a mesma de promote (ADR 0059)', () => {
    expect(groupActionCapability('add')).toBe('groups.add');
    expect(groupActionCapability('remove')).toBe('groups.remove');
    expect(groupActionCapability('promote')).toBe('groups.promote');
    expect(groupActionCapability('demote')).toBe('groups.promote');
  });
});
