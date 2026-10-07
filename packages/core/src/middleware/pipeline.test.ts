import { describe, expect, it } from 'vitest';
import { type Middleware, MiddlewarePipeline } from './pipeline.ts';
import { fakeContext } from './test-helpers.ts';

function tracer(log: string[], name: string): Middleware {
  return async (_ctx, next) => {
    log.push(`${name}:in`);
    await next();
    log.push(`${name}:out`);
  };
}

describe('MiddlewarePipeline', () => {
  it('pipeline vazio deixa a mensagem passar', async () => {
    await expect(new MiddlewarePipeline().run(fakeContext())).resolves.toBe(true);
  });

  it('executa em onion: ida na ordem, volta na ordem inversa', async () => {
    const log: string[] = [];
    const pipeline = new MiddlewarePipeline();
    pipeline.use(tracer(log, 'a'));
    pipeline.use(tracer(log, 'b'));

    await expect(pipeline.run(fakeContext())).resolves.toBe(true);
    expect(log).toEqual(['a:in', 'b:in', 'b:out', 'a:out']);
  });

  it('maior prioridade roda antes; empate mantém a ordem de registro', async () => {
    const log: string[] = [];
    const pipeline = new MiddlewarePipeline();
    pipeline.use(tracer(log, 'zero-1'));
    pipeline.use(tracer(log, 'baixa'), { priority: -5 });
    pipeline.use(tracer(log, 'alta'), { priority: 10 });
    pipeline.use(tracer(log, 'zero-2'));
    pipeline.use(tracer(log, 'alta-2'), { priority: 10 });

    await pipeline.run(fakeContext());
    expect(log.filter((entry) => entry.endsWith(':in'))).toEqual([
      'alta:in',
      'alta-2:in',
      'zero-1:in',
      'zero-2:in',
      'baixa:in',
    ]);
  });

  it('middleware que não chama next() interrompe a cadeia', async () => {
    const log: string[] = [];
    const pipeline = new MiddlewarePipeline();
    pipeline.use(tracer(log, 'fora'));
    pipeline.use(() => {
      log.push('barreira');
    });
    pipeline.use(tracer(log, 'dentro'));

    await expect(pipeline.run(fakeContext())).resolves.toBe(false);
    expect(log).toEqual(['fora:in', 'barreira', 'fora:out']);
  });

  it('aceita middleware síncrono que devolve next()', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use((_ctx, next) => next());
    await expect(pipeline.run(fakeContext())).resolves.toBe(true);
  });

  it('next() chamado duas vezes rejeita', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(async (_ctx, next) => {
      await next();
      await next();
    });
    await expect(pipeline.run(fakeContext())).rejects.toThrow('next() chamado mais de uma vez');
  });

  it('propaga erro síncrono e assíncrono para quem executa', async () => {
    const sync = new MiddlewarePipeline();
    sync.use(() => {
      throw new Error('síncrono');
    });
    await expect(sync.run(fakeContext())).rejects.toThrow('síncrono');

    const async = new MiddlewarePipeline();
    async.use(async () => {
      throw new Error('assíncrono');
    });
    await expect(async.run(fakeContext())).rejects.toThrow('assíncrono');
  });

  it('erro interno pode ser tratado por um middleware de fora', async () => {
    const pipeline = new MiddlewarePipeline();
    const caught: unknown[] = [];
    pipeline.use(async (_ctx, next) => {
      try {
        await next();
      } catch (error) {
        caught.push(error);
      }
    });
    pipeline.use(() => {
      throw new Error('falhou');
    });

    await expect(pipeline.run(fakeContext())).resolves.toBe(false);
    expect(caught).toHaveLength(1);
  });

  it('remove o middleware pela função devolvida por use (idempotente)', async () => {
    const log: string[] = [];
    const pipeline = new MiddlewarePipeline();
    pipeline.use(tracer(log, 'a'));
    const remove = pipeline.use(tracer(log, 'b'));
    pipeline.use(tracer(log, 'c'));

    remove();
    remove();
    expect(pipeline.size).toBe(2);
    await pipeline.run(fakeContext());
    expect(log).toEqual(['a:in', 'c:in', 'c:out', 'a:out']);
  });

  it('mudanças durante a execução não afetam a mensagem em andamento', async () => {
    const log: string[] = [];
    const pipeline = new MiddlewarePipeline();
    pipeline.use(async (_ctx, next) => {
      pipeline.use(tracer(log, 'tardio'));
      await next();
    });
    pipeline.use(tracer(log, 'b'));

    await pipeline.run(fakeContext());
    expect(log).toEqual(['b:in', 'b:out']);
  });

  it('rejeita prioridade não finita', () => {
    const pipeline = new MiddlewarePipeline();
    expect(() => pipeline.use(() => undefined, { priority: Number.NaN })).toThrow(RangeError);
  });

  describe('terminal (#225)', () => {
    it('roda no centro da cebola: a volta espera por ele', async () => {
      const log: string[] = [];
      const pipeline = new MiddlewarePipeline();
      pipeline.use(tracer(log, 'a'));
      pipeline.use(tracer(log, 'b'));

      const passed = await pipeline.run(fakeContext(), async () => {
        await Promise.resolve();
        log.push('terminal');
      });
      expect(passed).toBe(true);
      expect(log).toEqual(['a:in', 'b:in', 'terminal', 'b:out', 'a:out']);
    });

    it('não roda se um middleware interrompe', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(() => undefined);
      let ran = false;

      await expect(
        pipeline.run(fakeContext(), async () => {
          ran = true;
        }),
      ).resolves.toBe(false);
      expect(ran).toBe(false);
    });

    it('roda com o pipeline vazio, recebendo o contexto', async () => {
      const ctx = fakeContext();
      const got: unknown[] = [];

      await expect(
        new MiddlewarePipeline().run(ctx, async (received) => {
          got.push(received);
        }),
      ).resolves.toBe(true);
      expect(got).toEqual([ctx]);
    });

    it('erro do terminal chega ao try/catch do middleware de fora', async () => {
      const pipeline = new MiddlewarePipeline();
      const caught: unknown[] = [];
      pipeline.use(async (_ctx, next) => {
        try {
          await next();
        } catch (error) {
          caught.push(error);
        }
      });
      const boom = new Error('terminal');

      await pipeline.run(fakeContext(), () => Promise.reject(boom));
      expect(caught).toEqual([boom]);
    });
  });
});
