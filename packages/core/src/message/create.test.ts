import { describe, expect, it, vi } from 'vitest';
import { createMessage } from '#message/create.ts';

const base = {
  id: 'm1',
  chat: { id: 'grupo@g.us', isGroup: true },
  sender: { id: 'ana@s.whatsapp.net', name: 'Ana' },
  timestamp: 1_700_000_000_000,
  fromMe: false,
};

describe('createMessage', () => {
  it('preenche os padrões de quoted, mentions e flags', () => {
    const msg = createMessage({ ...base, type: 'text', text: 'oi' });
    expect(msg).toMatchObject({
      type: 'text',
      text: 'oi',
      quoted: null,
      mentions: [],
      isForwarded: false,
      isViewOnce: false,
      isEdited: false,
    });
  });

  it('padrão também vale para undefined explícito, e valores informados prevalecem', () => {
    const bia = { id: 'bia@s.whatsapp.net', name: null };
    const msg = createMessage({
      ...base,
      type: 'text',
      text: '@bia',
      quoted: undefined,
      mentions: [bia],
      isForwarded: true,
      isViewOnce: true,
      isEdited: true,
    });
    expect(msg.quoted).toBeNull();
    expect(msg.mentions).toEqual([bia]);
    expect([msg.isForwarded, msg.isViewOnce, msg.isEdited]).toEqual([true, true, true]);
  });

  it('is() compara o type em runtime, inclusive após spread', () => {
    const msg = createMessage({ ...base, type: 'voice', text: null, media: source() });
    expect(msg.is('voice')).toBe(true);
    expect(msg.is('audio')).toBe(false);
    const copy = { ...msg };
    expect(copy.is('voice')).toBe(true);
  });

  it('quoted é recursivo', () => {
    const inner = createMessage({ ...base, id: 'm0', type: 'image', text: null, media: source() });
    const middle = createMessage({ ...base, type: 'text', text: 'olha', quoted: inner });
    const outer = createMessage({ ...base, type: 'text', text: 'e aí?', quoted: middle });
    expect(outer.quoted?.quoted?.is('image')).toBe(true);
    expect(outer.quoted?.quoted?.id).toBe('m0');
  });

  it('embrulha a mídia em Media lazy', async () => {
    const download = vi.fn(async () => Buffer.from('abc'));
    const msg = createMessage({
      ...base,
      type: 'document',
      text: null,
      fileName: 'a.txt',
      media: { mimetype: 'text/plain', size: 3, download },
    });
    expect(msg.media).toMatchObject({ mimetype: 'text/plain', size: 3 });
    expect(download).not.toHaveBeenCalled();
    await msg.media.download();
    await msg.media.download();
    expect(download).toHaveBeenCalledOnce();
  });

  it('mantém os campos específicos do tipo', () => {
    const msg = createMessage({
      ...base,
      type: 'poll',
      text: null,
      poll: { name: 'Pizza?', options: ['sim', 'não'] },
    });
    expect(msg.poll.options).toEqual(['sim', 'não']);
    expect('media' in msg).toBe(false);
  });
});

function source() {
  return { mimetype: 'audio/ogg', download: async () => Buffer.alloc(0) };
}
