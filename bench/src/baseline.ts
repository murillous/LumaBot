// Comparação com o baseline (M2-4.2): o PR falha se um cenário piorar mais de 10% sobre a medida
// do commit base, tirada na mesma máquina (ADR 0054).

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Scenario } from './scenarios.ts';

/** Piora máxima aceita sobre o baseline (plano §7). */
export const TOLERANCE = 0.1;

/** O que a comparação usa de um resultado: o cenário e a mediana medida. */
export interface Measured {
  readonly name: string;
  readonly value: number;
}

export interface Comparison {
  readonly name: string;
  readonly value: number;
  /** Medida do baseline; `undefined` quando o cenário não existia nele. */
  readonly baseline: number | undefined;
  /**
   * Piora relativa ao baseline (0,1 = 10% pior; negativo = melhorou). `undefined` sem baseline ou
   * em cenário sem `checksRegression`.
   */
  readonly change: number | undefined;
  readonly regressed: boolean;
}

const reportSchema = z.object({
  results: z.array(z.object({ name: z.string(), value: z.number() })),
});

/** Lê o relatório do `--out` de outra execução. */
export async function readBaseline(path: string): Promise<readonly Measured[]> {
  const parsed = reportSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`baseline inválido em ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data.results;
}

/**
 * Compara cada resultado com o mesmo cenário no baseline. A piora é medida no sentido da meta:
 * subir é pior num teto (`max`), cair é pior num piso (`min`). Cenário sem `checksRegression`
 * ou ausente do baseline é listado, mas não falha.
 */
export function compare(
  scenarios: readonly Pick<Scenario, 'name' | 'target' | 'checksRegression'>[],
  results: readonly Measured[],
  baseline: readonly Measured[],
): Comparison[] {
  return results.map(({ name, value }) => {
    const scenario = scenarios.find((candidate) => candidate.name === name);
    if (scenario === undefined) throw new Error(`cenário desconhecido no resultado: ${name}`);
    const base = baseline.find((candidate) => candidate.name === name)?.value;
    if (base === undefined) {
      return { name, value, baseline: undefined, change: undefined, regressed: false };
    }
    // Sem a checagem, a variação nem é calculada: com o baseline perto de zero ou negativo, o
    // percentual sai enorme ou com o sinal trocado.
    if (!scenario.checksRegression) {
      return { name, value, baseline: base, change: undefined, regressed: false };
    }
    const change = 'max' in scenario.target ? (value - base) / base : (base - value) / base;
    return { name, value, baseline: base, change, regressed: change > TOLERANCE };
  });
}
