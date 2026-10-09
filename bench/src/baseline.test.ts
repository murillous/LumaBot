import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compare, readBaseline } from './baseline.ts';

const scenarios = [
  { name: 'overhead', target: { max: 1 }, checksRegression: true },
  { name: 'throughput', target: { min: 5_000 }, checksRegression: true },
  { name: 'memory-growth', target: { max: 5 }, checksRegression: false },
] as const;

describe('compare', () => {
  it('teto: subir mais de 10% regride', () => {
    const [within, over] = [
      compare(scenarios, [{ name: 'overhead', value: 0.22 }], [{ name: 'overhead', value: 0.2 }]),
      compare(scenarios, [{ name: 'overhead', value: 0.23 }], [{ name: 'overhead', value: 0.2 }]),
    ];
    expect(within[0]).toMatchObject({ baseline: 0.2, regressed: false });
    expect(within[0]?.change).toBeCloseTo(0.1);
    expect(over[0]).toMatchObject({ regressed: true });
    expect(over[0]?.change).toBeCloseTo(0.15);
  });

  it('piso: cair mais de 10% regride, subir é melhora', () => {
    const base = [{ name: 'throughput', value: 10_000 }];
    expect(compare(scenarios, [{ name: 'throughput', value: 8_900 }], base)[0]).toMatchObject({
      regressed: true,
    });
    const better = compare(scenarios, [{ name: 'throughput', value: 12_000 }], base)[0];
    expect(better).toMatchObject({ regressed: false });
    expect(better?.change).toBeCloseTo(-0.2);
  });

  it('cenário sem checksRegression não regride nem calcula a variação', () => {
    const [comparison] = compare(
      scenarios,
      [{ name: 'memory-growth', value: 2 }],
      [{ name: 'memory-growth', value: -0.2 }],
    );
    expect(comparison).toEqual({
      name: 'memory-growth',
      value: 2,
      baseline: -0.2,
      change: undefined,
      regressed: false,
    });
  });

  it('cenário ausente do baseline passa sem comparação', () => {
    expect(compare(scenarios, [{ name: 'overhead', value: 0.5 }], [])).toEqual([
      { name: 'overhead', value: 0.5, baseline: undefined, change: undefined, regressed: false },
    ]);
  });

  it('recusa resultado de cenário desconhecido', () => {
    expect(() => compare(scenarios, [{ name: 'nenhum', value: 1 }], [])).toThrow(/desconhecido/);
  });
});

describe('readBaseline', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function file(content: string): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'bench-baseline-'));
    const path = join(dir, 'base.json');
    await writeFile(path, content);
    return path;
  }

  it('lê o nome e a mediana do relatório do --out', async () => {
    const report = {
      node: 'v24.0.0',
      results: [{ name: 'overhead', value: 0.2, runs: [0.2], unit: 'ms', ok: true }],
    };
    expect(await readBaseline(await file(JSON.stringify(report)))).toEqual([
      { name: 'overhead', value: 0.2 },
    ]);
  });

  it('recusa relatório fora do formato', async () => {
    const path = await file(JSON.stringify({ results: [{ name: 'overhead' }] }));
    await expect(readBaseline(path)).rejects.toThrow(/baseline inválido/);
  });
});
