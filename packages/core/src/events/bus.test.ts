import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type EventBus } from '#events/bus.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { createMessage } from '#message/create.ts';
import type { Message } from '#message/types.ts';

const base = {
  id: 'm1',
  chat: { id: 'grupo@g.us', isGroup: true },
  sender: { id: 'ana@s.whatsapp.net', name: 'Ana' },
  timestamp: 0,
  fromMe: false,
};
const media = { mimetype: 'image/jpeg', download: async () => Buffer.alloc(0) };

const text = (quoted: Message | null = null): Message =>
  createMessage({ ...base, type: 'text', text: 'oi', quoted });
const image = (): Message => createMessage({ ...base, type: 'image', text: null, media });
const audio = (): Message => createMessage({ ...base, type: 'audio', text: null, media });

const noop = (): void => undefined;
let errors: PluginErrorEvent[];
let bus: EventBus;

beforeEach(() => {
  errors = [];
  bus = createEventBus({ onError: (e) => errors.push(e), listenerTimeoutMs: 1000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('assinatura e emissão', () => {
  it('entrega o payload no contexto e devolve quantos rodaram', async () => {
    const seen: unknown[] = [];
    bus.forPlugin('a').on('reaction', (ctx) => {
      seen.push(ctx.event, ctx.payload.emoji);
    });
    const payload = {
      chat: base.chat,
      messageId: 'x',
      sender: base.sender,
      emoji: '👍',
    };
    await expect(bus.emit('reaction', payload)).resolves.toEqual({
      listeners: 1,
      claimed: false,
      failed: 0,
    });
    expect(seen).toEqual(['reaction', '👍']);
  });

  it('sem listeners resolve vazio', async () => {
    await expect(bus.emit('group.left', { groupId: 'g' })).resolves.toEqual({
      listeners: 0,
      claimed: false,
      failed: 0,
    });
  });

  it('message alcança também message:<type>, numa só ordem por prioridade', async () => {
    const order: string[] = [];
    const sub = bus.forPlugin('a');
    sub.on('message', () => order.push('message 0'));
    sub.on('message:image', () => order.push('image 5'), { priority: 5 });
    sub.on('message:text', () => order.push('text'));
    sub.on('message', { priority: -1 }, () => order.push('message -1'));
    const result = await bus.emit('message', image());
    expect(order).toEqual(['image 5', 'message 0', 'message -1']);
    expect(result.listeners).toBe(3);
  });

  it('message:<type> recebe a mensagem estreitada', async () => {
    const listener = vi.fn();
    bus.forPlugin('a').on('message:image', (ctx) => listener(ctx.payload.media.mimetype));
    await bus.emit('message', image());
    expect(listener).toHaveBeenCalledWith('image/jpeg');
  });

  it('empate de prioridade segue a ordem de registro, inclusive entre message e message:<type>', async () => {
    const order: string[] = [];
    bus.forPlugin('a').on('message:text', () => order.push('1'));
    bus.forPlugin('b').on('message', () => order.push('2'));
    bus.forPlugin('c').on('message:text', () => order.push('3'));
    await bus.emit('message', text());
    expect(order).toEqual(['1', '2', '3']);
  });

  it('filtro quoted só deixa passar mensagens que citam o tipo pedido', async () => {
    const listener = vi.fn();
    const sub = bus.forPlugin('a');
    sub.on('message', { quoted: 'audio' }, listener);
    sub.on('message', listener, { quoted: ['image', 'video'] });

    await bus.emit('message', text());
    expect(listener).not.toHaveBeenCalled();
    await bus.emit('message', text(audio()));
    expect(listener).toHaveBeenCalledTimes(1);
    const result = await bus.emit('message', text(image()));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(result.listeners).toBe(1);
  });

  it('o unsubscribe remove só aquela assinatura e é idempotente', async () => {
    const listener = vi.fn();
    const sub = bus.forPlugin('a');
    const off = sub.on('message', listener);
    sub.on('message', listener);
    off();
    off();
    await bus.emit('message', text());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('message')).toBe(1);
  });

  it('(des)assinar durante a emissão não afeta a rodada em andamento', async () => {
    const second = vi.fn();
    const sub = bus.forPlugin('a');
    let off: () => void = noop;
    sub.on('message', () => off(), { priority: 1 });
    off = sub.on('message:text', second);
    await bus.emit('message', text());
    expect(second).toHaveBeenCalledTimes(1);
    await bus.emit('message', text());
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('removePlugin tira todos os listeners do plugin, em todos os eventos', async () => {
    const a = vi.fn();
    const b = vi.fn();
    bus.forPlugin('a').on('message', a);
    bus.forPlugin('a').on('message:text', a);
    bus.forPlugin('a').on('group.joined', a);
    bus.forPlugin('b').on('message', b);
    bus.removePlugin('a');
    await bus.emit('message', text());
    await bus.emit('group.joined', { groupId: 'g' });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('group.joined')).toBe(0);
  });

  it('repassa os extras de quem emite para o contexto', async () => {
    const seen = vi.fn();
    bus.forPlugin('a').on('message', (ctx) => seen((ctx as unknown as { reply: string }).reply));
    await bus.emit('message', text(), { reply: 'r' } as never);
    expect(seen).toHaveBeenCalledWith('r');
  });

  it('valida prioridade, prazo e listener', () => {
    const sub = bus.forPlugin('a');
    expect(() => sub.on('message', noop, { priority: Number.NaN })).toThrow(RangeError);
    expect(() => sub.on('message', noop, { timeoutMs: 0 })).toThrow(RangeError);
    expect(() => sub.on('message', noop, { timeoutMs: Infinity })).toThrow(RangeError);
    expect(() => sub.on('message', {} as never, {} as never)).toThrow(TypeError);
    expect(() => createEventBus({ onError: noop, listenerTimeoutMs: -1 })).toThrow(RangeError);
  });
});

describe('listeners em paralelo e claim()', () => {
  it('inicia todos sem esperar os anteriores terminarem', async () => {
    const started: string[] = [];
    let release: () => void = noop;
    const sub = bus.forPlugin('a');
    sub.on(
      'message',
      async () => {
        started.push('lento');
        await new Promise<void>((r) => {
          release = r;
        });
      },
      { priority: 1 },
    );
    sub.on('message', () => started.push('rápido'));
    const done = bus.emit('message', text());
    expect(started).toEqual(['lento', 'rápido']);
    release();
    await expect(done).resolves.toMatchObject({ listeners: 2, failed: 0 });
  });

  it('claim() antes do primeiro await é visível aos de prioridade menor', async () => {
    const seen: Record<string, boolean> = {};
    const sub = bus.forPlugin('a');
    sub.on(
      'message',
      async (ctx) => {
        seen['alto'] = ctx.claimed;
        ctx.claim();
        await Promise.resolve();
      },
      { priority: 10 },
    );
    sub.on('message:text', async (ctx) => {
      seen['medio'] = ctx.claimed;
      if (ctx.claimed) return;
      ctx.claim();
    });
    sub.on('message', { priority: -10 }, (ctx) => {
      seen['baixo'] = ctx.claimed;
    });
    const result = await bus.emit('message', text());
    expect(seen).toEqual({ alto: false, medio: true, baixo: true });
    expect(result.claimed).toBe(true);
  });

  it('claim de prioridade menor não aparece para quem já rodou antes', async () => {
    const seen: boolean[] = [];
    const sub = bus.forPlugin('a');
    sub.on('message', (ctx) => seen.push(ctx.claimed), { priority: 1 });
    sub.on('message', (ctx) => ctx.claim());
    await bus.emit('message', text());
    expect(seen).toEqual([false]);
  });

  it('cada emissão tem o próprio claim', async () => {
    const seen: boolean[] = [];
    const sub = bus.forPlugin('a');
    sub.on('message', (ctx) => {
      seen.push(ctx.claimed);
      ctx.claim();
    });
    await bus.emit('message', text());
    await bus.emit('message', text());
    expect(seen).toEqual([false, false]);
  });

  it('claim depois do await também conta no resultado', async () => {
    bus.forPlugin('a').on('message', async (ctx) => {
      await Promise.resolve();
      ctx.claim();
    });
    await expect(bus.emit('message', text())).resolves.toMatchObject({ claimed: true });
  });
});

describe('isolamento (M1-7.2)', () => {
  it('exceção síncrona não afeta os demais e emite plugin.error com o nome do plugin', async () => {
    const pluginErrors: PluginErrorEvent[] = [];
    bus.forPlugin('dashboard').on('plugin.error', (ctx) => {
      pluginErrors.push(ctx.payload);
    });
    const boom = new Error('boom');
    const after = vi.fn();
    bus.forPlugin('quebrado').on(
      'message',
      () => {
        throw boom;
      },
      { priority: 1 },
    );
    bus.forPlugin('ok').on('message', after);

    const result = await bus.emit('message', text());

    expect(after).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ listeners: 2, claimed: false, failed: 1 });
    const expected = {
      plugin: 'quebrado',
      phase: 'listener',
      event: 'message',
      error: boom,
      timedOut: false,
    };
    expect(pluginErrors).toEqual([expected]);
    expect(errors).toEqual([expected]);
  });

  it('rejeição vira plugin.error sem afetar os demais', async () => {
    const pluginErrors: PluginErrorEvent[] = [];
    bus.forPlugin('dashboard').on('plugin.error', (ctx) => {
      pluginErrors.push(ctx.payload);
    });
    const after = vi.fn();
    bus.forPlugin('quebrado').on('group.joined', async () => {
      await Promise.resolve();
      throw new Error('async');
    });
    bus.forPlugin('ok').on('group.joined', async () => {
      await Promise.resolve();
      after();
    });
    const result = await bus.emit('group.joined', { groupId: 'g' });
    expect(after).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
    expect(pluginErrors).toMatchObject([
      { plugin: 'quebrado', event: 'group.joined', timedOut: false },
    ]);
  });

  it('timeout emite plugin.error com timedOut e não segura os demais', async () => {
    vi.useFakeTimers();
    const pluginErrors: PluginErrorEvent[] = [];
    bus.forPlugin('dashboard').on('plugin.error', (ctx) => {
      pluginErrors.push(ctx.payload);
    });
    const fast = vi.fn();
    bus.forPlugin('travado').on('message', () => new Promise(noop), { timeoutMs: 50 });
    bus.forPlugin('lento').on('message', () => new Promise((r) => setTimeout(r, 500)));
    bus.forPlugin('ok').on('message', fast);

    let settled = false;
    const done = bus.emit('message', text()).then((r) => {
      settled = true;
      return r;
    });
    expect(fast).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(49);
    expect(pluginErrors).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(pluginErrors).toMatchObject([
      { plugin: 'travado', phase: 'listener', event: 'message', timedOut: true },
    ]);
    expect(settled).toBe(false);

    // O "lento" usa o prazo padrão do bus (1000 ms) e termina antes dele.
    await vi.advanceTimersByTimeAsync(450);
    await expect(done).resolves.toEqual({ listeners: 3, claimed: false, failed: 1 });
    expect(pluginErrors).toHaveLength(1);
  });

  it('usa o prazo padrão do bus quando o listener não define o seu', async () => {
    vi.useFakeTimers();
    bus.forPlugin('travado').on('message', () => new Promise(noop));
    const done = bus.emit('message', text());
    await vi.advanceTimersByTimeAsync(999);
    expect(errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toMatchObject([{ plugin: 'travado', timedOut: true }]);
    await expect(done).resolves.toMatchObject({ failed: 1 });
  });

  it('rejeição depois do prazo vai só para o onError', async () => {
    vi.useFakeTimers();
    const pluginErrors = vi.fn();
    bus.forPlugin('dashboard').on('plugin.error', pluginErrors);
    const late = new Error('tarde');
    bus
      .forPlugin('lento')
      .on('message', () => new Promise((_, reject) => setTimeout(() => reject(late), 200)), {
        timeoutMs: 100,
      });
    void bus.emit('message', text());
    await vi.advanceTimersByTimeAsync(200);
    expect(pluginErrors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(2);
    expect(errors[1]).toMatchObject({ plugin: 'lento', error: late, timedOut: false });
  });

  it('falha num listener de plugin.error vai para o onError, sem gerar outro plugin.error', async () => {
    const calls = vi.fn();
    bus.forPlugin('dashboard').on('plugin.error', () => {
      calls();
      throw new Error('dashboard caiu');
    });
    bus.forPlugin('quebrado').on('message', () => {
      throw new Error('boom');
    });
    await bus.emit('message', text());
    expect(calls).toHaveBeenCalledTimes(1);
    expect(errors.map((e) => [e.plugin, e.event])).toEqual([
      ['quebrado', 'message'],
      ['dashboard', 'plugin.error'],
    ]);
  });

  it('emit nunca rejeita', async () => {
    bus.forPlugin('a').on('message', () => Promise.reject(new Error('x')));
    await expect(bus.emit('message', text())).resolves.toMatchObject({ failed: 1 });
  });
});
