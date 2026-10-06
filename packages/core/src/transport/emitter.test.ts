import { describe, expect, it, vi } from 'vitest';
import { TypedEmitter } from './emitter.ts';

interface Events {
  ping: { readonly n: number };
  other: string;
}

function setup() {
  const errors: { error: unknown; event: keyof Events }[] = [];
  const emitter = new TypedEmitter<Events>((error, event) => errors.push({ error, event }));
  return { emitter, errors };
}

describe('TypedEmitter', () => {
  it('entrega o payload só aos assinantes do evento', () => {
    const { emitter } = setup();
    const ping = vi.fn();
    const other = vi.fn();
    emitter.on('ping', ping);
    emitter.on('other', other);

    emitter.emit('ping', { n: 1 });

    expect(ping).toHaveBeenCalledWith({ n: 1 });
    expect(other).not.toHaveBeenCalled();
  });

  it('emitir sem assinantes não faz nada', () => {
    const { emitter, errors } = setup();
    emitter.emit('ping', { n: 1 });
    expect(errors).toEqual([]);
  });

  it('unsubscribe remove o handler, é idempotente e libera a entrada do evento', () => {
    const { emitter } = setup();
    const handler = vi.fn();
    const off = emitter.on('ping', handler);

    off();
    off();
    emitter.emit('ping', { n: 1 });

    expect(handler).not.toHaveBeenCalled();
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  it('o mesmo handler assinado duas vezes gera assinaturas independentes', () => {
    const { emitter } = setup();
    const handler = vi.fn();
    const off = emitter.on('ping', handler);
    emitter.on('ping', handler);

    off();
    emitter.emit('ping', { n: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('erro síncrono vai para onError sem impedir os demais handlers', () => {
    const { emitter, errors } = setup();
    const boom = new Error('boom');
    const after = vi.fn();
    emitter.on('ping', () => {
      throw boom;
    });
    emitter.on('ping', after);

    emitter.emit('ping', { n: 1 });

    expect(after).toHaveBeenCalled();
    expect(errors).toEqual([{ error: boom, event: 'ping' }]);
  });

  it('rejeição de handler assíncrono vai para onError', async () => {
    const { emitter, errors } = setup();
    const boom = new Error('async');
    emitter.on('other', async () => {
      throw boom;
    });

    emitter.emit('other', 'x');
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toEqual([{ error: boom, event: 'other' }]);
  });

  it('handler que assina durante a emissão só recebe a partir da próxima', () => {
    const { emitter } = setup();
    const late = vi.fn();
    emitter.on('ping', () => {
      emitter.on('ping', late);
    });

    emitter.emit('ping', { n: 1 });
    expect(late).not.toHaveBeenCalled();

    emitter.emit('ping', { n: 2 });
    expect(late).toHaveBeenCalledWith({ n: 2 });
  });

  it('clear remove todas as assinaturas', () => {
    const { emitter } = setup();
    const handler = vi.fn();
    emitter.on('ping', handler);
    emitter.clear();
    emitter.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('instâncias não compartilham assinaturas', () => {
    const a = setup().emitter;
    const b = setup().emitter;
    const handler = vi.fn();
    a.on('ping', handler);
    b.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });
});
