import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

/** Percentil `p` (0–100) pelo método do vizinho mais próximo. Não altera `values`. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentil de uma lista vazia');
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentil fora de 0–100: ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/**
 * O `gc()` do V8 sem exigir `--expose-gc` de quem roda: os cenários de memória precisam de
 * leituras sem lixo pendente, e a flag ligada em tempo de execução vale para contextos novos.
 */
export function collectGarbage(): void {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  // Duas passadas: a primeira roda finalizadores que ainda soltam objetos para a segunda.
  gc();
  gc();
}

export const MB: number = 1024 * 1024;
