import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginErrorEvent } from '#events/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { kernelStorage } from '#storage/namespace.ts';
import type { Collection, JsonValue, StoragePort } from '#storage/types.ts';
import {
  createSchedulerService,
  JobHandlerConflictError,
  type SchedulerService,
  type SchedulerServiceOptions,
} from './service.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

let port: StoragePort;
let errors: PluginErrorEvent[];
let storageErrors: unknown[];
let services: SchedulerService[];

function create(overrides: Partial<SchedulerServiceOptions> = {}): SchedulerService {
  const service = createSchedulerService({
    storage: port,
    onError: (e) => errors.push(e),
    onStorageError: (e) => storageErrors.push(e),
    jobTimeoutMs: 1000,
    ...overrides,
  });
  services.push(service);
  return service;
}

/** Deixa promises e timers vencidos assentarem sem avançar o relógio. */
const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

function storedJobs(): Promise<unknown[]> {
  return kernelStorage(port, 'scheduler').collection('jobs').find();
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  port = createMemoryStorage();
  errors = [];
  storageErrors = [];
  services = [];
});

afterEach(async () => {
  for (const service of services) await service.stop();
  vi.useRealTimers();
});

describe('disparo', () => {
  it('chama o handler no horário com o payload e remove o job', async () => {
    const service = create();
    const scheduler = service.forPlugin('lembretes');
    const seen: JsonValue[] = [];
    scheduler.on('fire', (payload) => {
      seen.push(payload);
    });
    service.start();
    await scheduler.at(new Date(T0 + 5000), 'fire', { texto: 'oi' });

    await vi.advanceTimersByTimeAsync(4999);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([{ texto: 'oi' }]);
    expect(await storedJobs()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aceita epoch ms, payload ausente vira null e horário passado dispara logo', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const seen: JsonValue[] = [];
    scheduler.on('j', (payload) => {
      seen.push(payload);
    });
    service.start();
    await scheduler.at(T0 - 1000, 'j');
    await settle();
    expect(seen).toEqual([null]);
  });

  it('dispara em ordem de horário', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const seen: JsonValue[] = [];
    scheduler.on('j', (payload) => {
      seen.push(payload);
    });
    service.start();
    await scheduler.at(T0 + 300, 'j', 3);
    await scheduler.at(T0 + 100, 'j', 1);
    await scheduler.at(T0 + 200, 'j', 2);
    await vi.advanceTimersByTimeAsync(300);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('não dispara antes de start()', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const handler = vi.fn();
    scheduler.on('j', handler);
    await scheduler.at(T0 + 100, 'j');
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    service.start();
    await settle();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('job além do teto do setTimeout (~24,8 dias) dispara na data certa', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const firedAt: number[] = [];
    scheduler.on('j', () => {
      firedAt.push(Date.now());
    });
    service.start();
    await scheduler.at(T0 + 60 * DAY, 'j');
    await vi.advanceTimersByTimeAsync(30 * DAY);
    expect(firedAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(30 * DAY);
    expect(firedAt).toEqual([T0 + 60 * DAY]);
  });
});

describe('um único loop para o bot inteiro', () => {
  it('no máximo um timer, de vários plugins e jobs', async () => {
    const service = create();
    service.start();
    await settle();
    expect(vi.getTimerCount()).toBe(0);

    for (const name of ['a', 'b', 'c']) {
      const scheduler = service.forPlugin(name);
      scheduler.on('j', () => undefined);
      for (let i = 1; i <= 5; i++) await scheduler.at(T0 + i * 1000, 'j');
    }
    await settle();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(2500);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(await storedJobs()).toEqual([]);
  });

  it('agendar antes do armado rearma; depois não cria outro timer', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const seen: JsonValue[] = [];
    scheduler.on('j', (payload) => {
      seen.push(payload);
    });
    service.start();
    await scheduler.at(T0 + 10_000, 'j', 'tarde');
    await scheduler.at(T0 + 1000, 'j', 'cedo');
    await scheduler.at(T0 + 20_000, 'j', 'mais tarde');
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual(['cedo']);
  });
});

describe('namespace por plugin', () => {
  it('dois plugins usam o mesmo nome de job sem colidir', async () => {
    const service = create();
    const a = service.forPlugin('a');
    const b = service.forPlugin('b');
    const seenA: JsonValue[] = [];
    const seenB: JsonValue[] = [];
    a.on('fire', (p) => {
      seenA.push(p);
    });
    b.on('fire', (p) => {
      seenB.push(p);
    });
    service.start();
    await a.at(T0 + 100, 'fire', 'de a');
    await b.at(T0 + 100, 'fire', 'de b');
    await vi.advanceTimersByTimeAsync(100);
    expect(seenA).toEqual(['de a']);
    expect(seenB).toEqual(['de b']);
  });

  it('um plugin não cancela o job de outro', async () => {
    const service = create();
    const id = await service.forPlugin('a').at(T0 + 100, 'j');
    expect(await service.forPlugin('b').cancel(id)).toBe(false);
    expect(await service.forPlugin('a').cancel(id)).toBe(true);
  });
});

describe('persistência e restart', () => {
  it('jobs sobrevivem a restart', async () => {
    const first = create();
    await first.forPlugin('p').at(T0 + 5000, 'j', { n: 1 });
    first.start();
    await first.stop();
    expect(vi.getTimerCount()).toBe(0);

    const second = create();
    const seen: JsonValue[] = [];
    second.forPlugin('p').on('j', (payload) => {
      seen.push(payload);
    });
    second.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('jobs vencidos durante o downtime disparam ao subir', async () => {
    const first = create();
    await first.forPlugin('p').at(T0 + 1000, 'j', 'atrasado');
    await first.forPlugin('p').at(T0 + 2 * DAY, 'j', 'futuro');
    first.start();
    await first.stop();

    // Bot desligado por um dia: nenhum timer vivo, nada dispara.
    vi.setSystemTime(T0 + DAY);

    const second = create();
    const seen: JsonValue[] = [];
    second.forPlugin('p').on('j', (payload) => {
      seen.push(payload);
    });
    second.start();
    await settle();
    expect(seen).toEqual(['atrasado']);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(seen).toEqual(['atrasado', 'futuro']);
  });

  it('job cujo handler não terminou antes da queda é entregue de novo (pelo menos uma vez)', async () => {
    const first = create({ jobTimeoutMs: 10 * DAY });
    let calls = 0;
    first.forPlugin('p').on('j', () => {
      calls++;
      return new Promise(() => undefined);
    });
    first.start();
    await first.forPlugin('p').at(T0 + 100, 'j');
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);
    // Queda: o processo morre sem stop() (o handler segue preso para sempre); o documento
    // continua no storage.
    services.splice(services.indexOf(first), 1);
    expect(await storedJobs()).toHaveLength(1);

    const second = create();
    const handler = vi.fn();
    second.forPlugin('p').on('j', handler);
    second.start();
    await settle();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('job sem handler', () => {
  it('fica pendente até o plugin registrar o handler', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    service.start();
    await scheduler.at(T0 + 100, 'j', 'x');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await storedJobs()).toHaveLength(1);
    // Sem polling: o job vencido sem handler não mantém timer armado.
    expect(vi.getTimerCount()).toBe(0);

    const seen: JsonValue[] = [];
    scheduler.on('j', (payload) => {
      seen.push(payload);
    });
    await settle();
    expect(seen).toEqual(['x']);
    expect(await storedJobs()).toEqual([]);
  });

  it('removePlugin tira os handlers mas mantém os jobs (reload)', async () => {
    const service = create();
    const before = vi.fn();
    service.forPlugin('p').on('j', before);
    service.start();
    await service.forPlugin('p').at(T0 + 100, 'j');
    service.removePlugin('p');
    await vi.advanceTimersByTimeAsync(100);
    expect(before).not.toHaveBeenCalled();
    expect(await storedJobs()).toHaveLength(1);

    const after = vi.fn();
    service.forPlugin('p').on('j', after);
    await settle();
    expect(after).toHaveBeenCalledOnce();
  });

  it('unsubscribe desfaz só o próprio handler', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const off = scheduler.on('j', () => undefined);
    expect(() => scheduler.on('j', () => undefined)).toThrow(JobHandlerConflictError);
    off();
    const handler = vi.fn();
    const offNew = scheduler.on('j', handler);
    off(); // chamada repetida do antigo não remove o novo
    service.start();
    await scheduler.at(T0, 'j');
    await settle();
    expect(handler).toHaveBeenCalledOnce();
    offNew();
  });
});

describe('falhas', () => {
  it('handler que lança vira plugin.error e não derruba o loop', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const boom = new Error('boom');
    const ok = vi.fn();
    scheduler.on('ruim', () => {
      throw boom;
    });
    scheduler.on('bom', ok);
    service.start();
    await scheduler.at(T0 + 100, 'ruim');
    await scheduler.at(T0 + 200, 'bom');
    await vi.advanceTimersByTimeAsync(200);
    expect(errors).toEqual([
      { plugin: 'p', phase: 'scheduler', event: 'ruim', error: boom, timedOut: false },
    ]);
    expect(ok).toHaveBeenCalledOnce();
    // Sem retentativa: o job que falhou sai do storage.
    expect(await storedJobs()).toEqual([]);
  });

  it('handler que rejeita vira plugin.error', async () => {
    const service = create();
    const boom = new Error('async');
    service.forPlugin('p').on('j', async () => {
      throw boom;
    });
    service.start();
    await service.forPlugin('p').at(T0, 'j');
    await settle();
    expect(errors).toEqual([
      { plugin: 'p', phase: 'scheduler', event: 'j', error: boom, timedOut: false },
    ]);
  });

  it('handler que estoura o prazo vira plugin.error com timedOut', async () => {
    const service = create({ jobTimeoutMs: 500 });
    service.forPlugin('p').on('j', () => new Promise(() => undefined));
    service.start();
    await service.forPlugin('p').at(T0, 'j');
    await vi.advanceTimersByTimeAsync(499);
    expect(errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      plugin: 'p',
      phase: 'scheduler',
      event: 'j',
      timedOut: true,
    });
    expect(await storedJobs()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falha do storage vai ao onStorageError e o loop tenta de novo', async () => {
    const real = kernelStorage(port, 'scheduler').collection('jobs');
    let failures = 1;
    const flaky: StoragePort = {
      ...port,
      forNamespace(namespace) {
        const storage = port.forNamespace(namespace);
        return {
          kv: storage.kv,
          collection: <T extends { readonly [key: string]: JsonValue }>() => {
            const c = real as unknown as Collection<T>;
            return {
              ...c,
              find: async (query) => {
                if (failures > 0) {
                  failures--;
                  throw new Error('storage fora');
                }
                return c.find(query);
              },
            };
          },
        };
      },
    };
    const service = create({ storage: flaky, storageRetryMs: 1000 });
    const handler = vi.fn();
    service.forPlugin('p').on('j', handler);
    await service.forPlugin('p').at(T0, 'j');
    service.start();
    await settle();
    expect(storageErrors).toHaveLength(1);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('validação de at', () => {
  it('recusa horário inválido', async () => {
    const scheduler = create().forPlugin('p');
    await expect(scheduler.at(new Date('nada'), 'j')).rejects.toThrow(TypeError);
    await expect(scheduler.at(Number.NaN, 'j')).rejects.toThrow(TypeError);
    await expect(scheduler.at(Number.POSITIVE_INFINITY, 'j')).rejects.toThrow(TypeError);
    await expect(scheduler.at('2026' as never, 'j')).rejects.toThrow(TypeError);
  });

  it('recusa nome de job vazio', async () => {
    const scheduler = create().forPlugin('p');
    await expect(scheduler.at(T0, '')).rejects.toThrow(TypeError);
    expect(() => scheduler.on('', () => undefined)).toThrow(TypeError);
  });

  it('recusa payload que não é JSON', async () => {
    const scheduler = create().forPlugin('p');
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const bad: unknown[] = [
      { a: undefined },
      [Number.NaN],
      new Date(),
      new Map(),
      () => 1,
      { n: 10n },
      cycle,
    ];
    for (const payload of bad) {
      await expect(scheduler.at(T0, 'j', payload as JsonValue)).rejects.toThrow(TypeError);
    }
    expect(await storedJobs()).toEqual([]);
  });

  it('aceita o mesmo objeto repetido sem ser ciclo', async () => {
    const scheduler = create().forPlugin('p');
    const shared = { x: 1 };
    await expect(scheduler.at(T0, 'j', { a: shared, b: [shared] })).resolves.toBeTypeOf('string');
  });

  it('recusa prazos inválidos nas opções', () => {
    expect(() => create({ jobTimeoutMs: 0 })).toThrow(RangeError);
    expect(() => create({ storageRetryMs: Number.NaN })).toThrow(RangeError);
  });
});

describe('cancel', () => {
  it('true antes de disparar e o job não dispara', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const handler = vi.fn();
    scheduler.on('j', handler);
    service.start();
    const id = await scheduler.at(T0 + 100, 'j');
    expect(await scheduler.cancel(id)).toBe(true);
    expect(await scheduler.cancel(id)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).not.toHaveBeenCalled();
  });

  it('false para id desconhecido, job já disparado ou em andamento', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    let release: () => void = () => undefined;
    scheduler.on('lento', () => new Promise<void>((r) => (release = r)));
    scheduler.on('rapido', () => undefined);
    service.start();
    expect(await scheduler.cancel('nao-existe')).toBe(false);

    const fast = await scheduler.at(T0, 'rapido');
    const slow = await scheduler.at(T0, 'lento');
    await settle();
    expect(await scheduler.cancel(fast)).toBe(false);
    expect(await scheduler.cancel(slow)).toBe(false);
    release();
    await settle();
    expect(await storedJobs()).toEqual([]);
  });

  it('cancel concorrente com a volta do loop: ou cancela, ou dispara', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    const handler = vi.fn();
    scheduler.on('j', handler);
    const id = await scheduler.at(T0, 'j');
    service.start(); // a volta do loop já leu o job vencido
    const cancelled = await scheduler.cancel(id);
    await settle();
    expect(cancelled).toBe(handler.mock.calls.length === 0);
  });
});

describe('stop', () => {
  it('desarma o timer e espera o handler em andamento', async () => {
    const service = create();
    const scheduler = service.forPlugin('p');
    let finished = false;
    scheduler.on('j', async () => {
      await new Promise((r) => setTimeout(r, 300));
      finished = true;
    });
    const later = vi.fn();
    scheduler.on('depois', later);
    service.start();
    await scheduler.at(T0, 'j');
    await scheduler.at(T0 + 10_000, 'depois');
    await settle();

    let stopped = false;
    const stopping = service.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(finished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(later).not.toHaveBeenCalled();
    expect(await storedJobs()).toHaveLength(1);
  });

  it('handler preso não segura o stop além do prazo do job', async () => {
    const service = create({ jobTimeoutMs: 1000 });
    service.forPlugin('p').on('j', () => new Promise(() => undefined));
    service.start();
    await service.forPlugin('p').at(T0, 'j');
    await settle();
    const stopping = service.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    expect(errors[0]?.timedOut).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('at depois do stop persiste sem armar timer; start de novo retoma', async () => {
    const service = create();
    const handler = vi.fn();
    service.forPlugin('p').on('j', handler);
    service.start();
    await service.stop();
    await service.stop();
    await service.forPlugin('p').at(T0 + 100, 'j');
    expect(vi.getTimerCount()).toBe(0);
    service.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(handler).toHaveBeenCalledOnce();
  });
});
