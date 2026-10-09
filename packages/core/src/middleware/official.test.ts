import { describe, expect, it, vi } from 'vitest';
import { chatFilter } from './chat-filter.ts';
import { ignoreBots } from './ignore-bots.ts';
import { ignoreSelf } from './ignore-self.ts';
import { type Middleware, MiddlewarePipeline } from './pipeline.ts';
import { RateLimiter, rateLimit } from './rate-limit.ts';
import { type SanitizedContext, sanitize } from './sanitize.ts';
import { type FakeMessageInit, fakeContext } from './test-helpers.ts';

function passes(middleware: Middleware, init: FakeMessageInit = {}): Promise<boolean> {
  const pipeline = new MiddlewarePipeline();
  pipeline.use(middleware);
  return pipeline.run(fakeContext(init));
}

describe('ignoreSelf', () => {
  it('barra mensagens do próprio bot e deixa as outras passarem', async () => {
    await expect(passes(ignoreSelf(), { fromMe: true })).resolves.toBe(false);
    await expect(passes(ignoreSelf(), { fromMe: false })).resolves.toBe(true);
  });
});

describe('ignoreBots', () => {
  it('barra remetente com isBot e deixa passar quem não tem o campo ou tem false', async () => {
    await expect(passes(ignoreBots(), { senderIsBot: true })).resolves.toBe(false);
    await expect(passes(ignoreBots(), { senderIsBot: false })).resolves.toBe(true);
    await expect(passes(ignoreBots())).resolves.toBe(true);
  });
});

describe('chatFilter', () => {
  it('com allow, só os chats listados passam', async () => {
    const filter = chatFilter({ allow: ['a'] });
    await expect(passes(filter, { chatId: 'a' })).resolves.toBe(true);
    await expect(passes(filter, { chatId: 'b' })).resolves.toBe(false);
  });

  it('block barra o chat, mesmo se ele também estiver em allow', async () => {
    const filter = chatFilter({ allow: ['a', 'b'], block: ['b'] });
    await expect(passes(filter, { chatId: 'a' })).resolves.toBe(true);
    await expect(passes(filter, { chatId: 'b' })).resolves.toBe(false);
  });

  it('sem listas deixa tudo passar', async () => {
    await expect(passes(chatFilter({}), { chatId: 'qualquer' })).resolves.toBe(true);
  });
});

describe('RateLimiter', () => {
  it('permite até max por janela e libera quando a janela vence', () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 2, windowMs: 1000, clock: () => now });
    expect([limiter.hit('k'), limiter.hit('k'), limiter.hit('k')]).toEqual([true, true, false]);
    now = 999;
    expect(limiter.hit('k')).toBe(false);
    now = 1000;
    expect(limiter.hit('k')).toBe(true);
  });

  it('chaves são independentes', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, clock: () => 0 });
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('b')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
  });

  it('expira entradas: a memória não cresce com chaves que sumiram', () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 10, windowMs: 1000, clock: () => now });
    for (let i = 0; i < 10_000; i++) limiter.hit(`velho-${i}`);
    expect(limiter.size).toBe(10_000);

    now = 1000;
    limiter.hit('novo');
    expect(limiter.size).toBe(1);
  });

  it('varredura remove só as janelas vencidas', () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 10, windowMs: 1000, clock: () => now });
    limiter.hit('a');
    now = 500;
    limiter.hit('b');
    now = 1200;
    limiter.hit('c');
    expect(limiter.size).toBe(2); // 'a' venceu; 'b' e 'c' seguem abertas
  });

  it('valida as opções', () => {
    expect(() => new RateLimiter({ max: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new RateLimiter({ max: 1.5, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new RateLimiter({ max: 1, windowMs: 0 })).toThrow(RangeError);
    expect(() => new RateLimiter({ max: 1, windowMs: Number.NaN })).toThrow(RangeError);
  });
});

describe('rateLimit', () => {
  it('por remetente (padrão): conta o mesmo remetente em chats diferentes', async () => {
    const onLimited = vi.fn();
    const limit = rateLimit({ max: 1, windowMs: 1000, clock: () => 0, onLimited });
    await expect(passes(limit, { senderId: 'u', chatId: 'a' })).resolves.toBe(true);
    await expect(passes(limit, { senderId: 'u', chatId: 'b' })).resolves.toBe(false);
    await expect(passes(limit, { senderId: 'v', chatId: 'a' })).resolves.toBe(true);
    expect(onLimited).toHaveBeenCalledOnce();
  });

  it('por chat: remetentes diferentes dividem o limite do chat', async () => {
    const limit = rateLimit({ max: 1, windowMs: 1000, clock: () => 0, by: 'chat' });
    await expect(passes(limit, { senderId: 'u', chatId: 'a' })).resolves.toBe(true);
    await expect(passes(limit, { senderId: 'v', chatId: 'a' })).resolves.toBe(false);
    await expect(passes(limit, { senderId: 'u', chatId: 'b' })).resolves.toBe(true);
  });

  it('por remetente em cada chat', async () => {
    const limit = rateLimit({ max: 1, windowMs: 1000, clock: () => 0, by: 'sender-in-chat' });
    await expect(passes(limit, { senderId: 'u', chatId: 'a' })).resolves.toBe(true);
    await expect(passes(limit, { senderId: 'u', chatId: 'b' })).resolves.toBe(true);
    await expect(passes(limit, { senderId: 'u', chatId: 'a' })).resolves.toBe(false);
  });

  it('erro em onLimited propaga para quem executa o pipeline', async () => {
    const limit = rateLimit({
      max: 1,
      windowMs: 1000,
      clock: () => 0,
      onLimited: () => {
        throw new Error('log falhou');
      },
    });
    await passes(limit);
    await expect(passes(limit)).rejects.toThrow('log falhou');
  });
});

describe('sanitize', () => {
  async function sanitized(
    init: FakeMessageInit,
    options?: Parameters<typeof sanitize>[0],
  ): Promise<SanitizedContext> {
    const ctx: SanitizedContext = fakeContext(init);
    const pipeline = new MiddlewarePipeline<SanitizedContext>();
    pipeline.use(sanitize(options));
    await expect(pipeline.run(ctx)).resolves.toBe(true);
    return ctx;
  }

  it('mantém valores dentro do limite', async () => {
    const ctx = await sanitized({ text: 'oi', senderName: null });
    expect(ctx.sanitized).toEqual({ text: 'oi', senderName: null });
  });

  it('trunca texto e nome sem alterar ctx.message', async () => {
    const ctx = await sanitized({ text: 'x'.repeat(5000), senderName: 'n'.repeat(150) });
    expect(ctx.sanitized?.text).toHaveLength(4096);
    expect(ctx.sanitized?.senderName).toHaveLength(100);
    expect(ctx.message.text).toHaveLength(5000);
  });

  it('não corta um par surrogate ao meio', async () => {
    const ctx = await sanitized({ text: 'ab😀c' }, { maxTextLength: 3 });
    expect(ctx.sanitized?.text).toBe('ab');
  });

  it('valida as opções', () => {
    expect(() => sanitize({ maxTextLength: 0 })).toThrow(RangeError);
    expect(() => sanitize({ maxSenderNameLength: 2.5 })).toThrow(RangeError);
  });
});
