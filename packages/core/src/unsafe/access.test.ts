import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '#logger/types.ts';
import { createUnsafeAccess } from './access.ts';

function fakeLogger() {
  const log = {
    level: 'trace' as const,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: (): Logger => log,
  };
  return log;
}

describe('createUnsafeAccess', () => {
  it('native devolve o objeto nativo atual do transport, mesmo depois de trocado', () => {
    const transport: { name: string; native: unknown } = { name: 'baileys', native: { socket: 1 } };
    const unsafe = createUnsafeAccess({ transport, log: fakeLogger() }).forPlugin({
      name: 'p',
      transports: ['baileys'],
    });

    expect(unsafe.native).toEqual({ socket: 1 });
    transport.native = { socket: 2 };
    expect(unsafe.native).toEqual({ socket: 2 });
  });

  it('só avisa quando native é lido', () => {
    const log = fakeLogger();
    createUnsafeAccess({ transport: { name: 'baileys', native: {} }, log }).forPlugin({
      name: 'p',
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('avisa uma única vez por plugin, mesmo com vários Unsafe do mesmo plugin', () => {
    const log = fakeLogger();
    const access = createUnsafeAccess({ transport: { name: 'baileys', native: {} }, log });
    const first = access.forPlugin({ name: 'a', transports: ['baileys'] });
    const second = access.forPlugin({ name: 'a', transports: ['baileys'] });

    void first.native;
    void first.native;
    void second.native;
    expect(log.warn).toHaveBeenCalledTimes(1);

    void access.forPlugin({ name: 'b', transports: ['baileys'] }).native;
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('o registro de avisos é por bot: outra instância avisa de novo', () => {
    const log = fakeLogger();
    const transport = { name: 'baileys', native: {} };
    void createUnsafeAccess({ transport, log }).forPlugin({ name: 'a' }).native;
    void createUnsafeAccess({ transport, log }).forPlugin({ name: 'a' }).native;
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('o aviso é warn e traz plugin e transport, na mensagem e nos campos', () => {
    const log = fakeLogger();
    const access = createUnsafeAccess({ transport: { name: 'baileys', native: {} }, log });
    void access.forPlugin({ name: 'stickers', transports: ['baileys'] }).native;

    expect(log.warn).toHaveBeenCalledTimes(1);
    const [message, fields] = log.warn.mock.calls[0] ?? [];
    expect(message).toContain('stickers');
    expect(message).toContain('baileys');
    expect(message).not.toContain('sem declarar transports');
    expect(fields).toEqual({ plugin: 'stickers', transport: 'baileys' });
  });

  it('sem transports no manifesto, o aviso diz que o plugin fica preso ao transport', () => {
    const log = fakeLogger();
    const access = createUnsafeAccess({ transport: { name: 'baileys', native: {} }, log });
    const unsafe = access.forPlugin({ name: 'stickers' });

    // O acesso não é bloqueado.
    expect(unsafe.native).toEqual({});
    const [message] = log.warn.mock.calls[0] ?? [];
    expect(message).toContain('sem declarar transports');
    expect(message).toContain("transports: ['baileys']");
  });
});
