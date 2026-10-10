// Buffer de envio e arquivos em memória (ADR 0077): validade sem timer e tetos.

import { describe, expect, it } from 'vitest';
import { MEDIA_TTL_MS, MediaStore } from './media-store.ts';
import { OUTBOX_MAX_FRAMES, OUTBOX_TTL_MS, Outbox } from './outbox.ts';
import type { ServerFrame } from './protocol.ts';

const frame = (id: string): ServerFrame => ({ type: 'delete', id });

describe('Outbox', () => {
  it('entrega em ordem e esvazia a conversa', () => {
    const outbox = new Outbox();
    outbox.push('c', frame('1'));
    outbox.push('c', frame('2'));
    expect(outbox.drain('c')).toEqual([frame('1'), frame('2')]);
    expect(outbox.drain('c')).toEqual([]);
  });

  it('guarda até 100 frames por conversa, soltando o mais antigo', () => {
    const outbox = new Outbox();
    for (let i = 0; i <= OUTBOX_MAX_FRAMES; i++) outbox.push('c', frame(String(i)));
    const drained = outbox.drain('c');
    expect(drained).toHaveLength(OUTBOX_MAX_FRAMES);
    expect(drained[0]).toEqual(frame('1'));
  });

  it('frame vencido não sai, e a conversa parada some no próximo envio', () => {
    let now = 0;
    const outbox = new Outbox(() => now);
    outbox.push('velha', frame('v'));
    now = OUTBOX_TTL_MS / 2;
    outbox.push('nova', frame('n1'));
    now = OUTBOX_TTL_MS;
    outbox.push('nova', frame('n2'));
    // A `velha` venceu e saiu da memória; a `nova` segue.
    expect(outbox.size).toBe(1);
    now = OUTBOX_TTL_MS * 1.5;
    expect(outbox.drain('nova')).toEqual([frame('n2')]);
  });
});

describe('MediaStore', () => {
  const media = (bytes: string, owner?: string) => ({
    bytes: Buffer.from(bytes),
    mimetype: 'text/plain',
    ...(owner === undefined ? null : { owner }),
  });

  it('o ID tem 128 bits em base64url e vale por 1 h', () => {
    let now = 0;
    const store = new MediaStore({ now: () => now });
    const id = store.put(media('a'));
    expect(id).toMatch(/^[\w-]{22}$/);
    now = MEDIA_TTL_MS - 1;
    expect(store.get(id)?.bytes.toString()).toBe('a');
    now = MEDIA_TTL_MS;
    expect(store.get(id)).toBeUndefined();
  });

  it('`takeAll` só entrega ao dono, todos ou nenhum, e uma vez', () => {
    const store = new MediaStore();
    const a = store.put(media('a', 'u1'));
    const b = store.put(media('b', 'u1'));
    const deOutro = store.put(media('c', 'u2'));
    expect(store.takeAll([a, deOutro], 'u1')).toBeUndefined();
    expect(store.size).toBe(3);
    expect(store.takeAll([a, b], 'u1')?.map((m) => m.bytes.toString())).toEqual(['a', 'b']);
    expect(store.takeAll([a], 'u1')).toBeUndefined();
  });

  it('acima do teto total, sai o mais antigo', () => {
    const store = new MediaStore({ maxBytes: 4 });
    const first = store.put(media('aa'));
    const second = store.put(media('bb'));
    const third = store.put(media('cc'));
    expect(store.get(first)).toBeUndefined();
    expect(store.get(second)).toBeDefined();
    expect(store.get(third)).toBeDefined();
  });
});
