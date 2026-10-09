// Os cenários com cargas pequenas: conferem que medem e que a carga roda inteira. Os números de
// verdade saem do `pnpm bench`, num processo por execução.

import { describe, expect, it } from 'vitest';
import { boot, evaluate, memoryGrowth, overhead, SCENARIOS, throughput } from './scenarios.ts';

describe('cenários', () => {
  it('cobrem as 5 metas do plano §7', () => {
    expect(SCENARIOS.map((scenario) => scenario.name)).toEqual([
      'overhead',
      'throughput',
      'idle-memory',
      'memory-growth',
      'boot',
    ]);
  });

  it('overhead devolve o p99 em ms', async () => {
    const p99 = await overhead({ warmup: 30, messages: 300 });
    expect(p99).toBeGreaterThan(0);
  });

  it('vazão devolve msg/s', async () => {
    expect(await throughput({ warmup: 500, messages: 3_000 })).toBeGreaterThan(0);
  });

  it('crescimento de memória devolve MB', async () => {
    const growth = await memoryGrowth({ warmup: 1_000, messages: 3_000 });
    expect(Number.isFinite(growth)).toBe(true);
  });

  it('boot devolve ms', async () => {
    expect(await boot()).toBeGreaterThan(0);
  });
});

describe('evaluate', () => {
  it('teto: passa abaixo do máximo, com a mediana das execuções', () => {
    expect(evaluate({ target: { max: 1 } }, [0.5, 2, 0.4])).toEqual({ value: 0.5, ok: true });
    expect(evaluate({ target: { max: 1 } }, [1, 2, 0.4])).toEqual({ value: 1, ok: false });
  });

  it('piso: passa a partir do mínimo', () => {
    expect(evaluate({ target: { min: 5_000 } }, [5_000])).toEqual({ value: 5_000, ok: true });
    expect(evaluate({ target: { min: 5_000 } }, [4_999])).toEqual({ value: 4_999, ok: false });
  });
});
