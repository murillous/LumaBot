import type { PluginManifest } from './types.ts';

/** O que a ordenação lê do manifesto. */
export type OrderableManifest = Pick<PluginManifest, 'name' | 'priority' | 'after' | 'dependsOn'>;

/** `dependsOn`/`after` formam um ciclo: não existe ordem de carga possível. Erro no boot. */
export class PluginCycleError extends Error {
  override readonly name = 'PluginCycleError';
  /** Caminho do ciclo, fechando no primeiro: `['a', 'b', 'a']` = a depende de b, b de a. */
  readonly cycle: readonly string[];

  constructor(cycle: readonly string[]) {
    super(
      `Ciclo na ordem de carga dos plugins: ${cycle.join(' → ')} ` +
        '(→ = depende de / carrega depois de). Remova um dos dependsOn/after.',
    );
    this.cycle = cycle;
  }
}

/**
 * Ordem de carga (ADR 0007): toposort em que `dependsOn` e `after` são arestas (a dependência
 * vem antes) e, entre os prontos, desempata `priority` maior e depois a ordem recebida. Nomes
 * citados que não estão na lista não criam aresta — dependência ausente é motivo de "ignorado",
 * não de ordem. Lança `PluginCycleError` com o caminho do ciclo.
 */
export function sortPlugins<T extends OrderableManifest>(plugins: readonly T[]): T[] {
  const index = new Map(plugins.map((plugin, i) => [plugin.name, i]));
  // predecessors[i]: índices que precisam carregar antes de i.
  const predecessors = plugins.map((plugin) => {
    const before = new Set<number>();
    for (const name of [...Object.keys(plugin.dependsOn ?? {}), ...(plugin.after ?? [])]) {
      const j = index.get(name);
      if (j !== undefined) before.add(j);
    }
    return before;
  });
  const pending = predecessors.map((before) => before.size);
  const done = new Set<number>();
  const result: T[] = [];

  // O(n²) de propósito: são dezenas de plugins, e a escolha explícita do melhor pronto deixa a
  // regra de desempate óbvia.
  while (result.length < plugins.length) {
    let best: number | undefined;
    for (let i = 0; i < plugins.length; i++) {
      if (done.has(i) || pending[i] !== 0) continue;
      if (best === undefined || priorityOf(plugins, i) > priorityOf(plugins, best)) best = i;
    }
    if (best === undefined) throw new PluginCycleError(findCycle(plugins, predecessors, done));
    done.add(best);
    result.push(plugins[best] as T);
    predecessors.forEach((before, i) => {
      if (before.has(best)) pending[i] = (pending[i] ?? 0) - 1;
    });
  }
  return result;
}

const priorityOf = (plugins: readonly OrderableManifest[], i: number): number =>
  plugins[i]?.priority ?? 0;

/**
 * Todo nó que sobrou tem um predecessor que também sobrou; andando de predecessor em
 * predecessor, uma hora repete — o trecho desde a repetição é o ciclo.
 */
function findCycle(
  plugins: readonly OrderableManifest[],
  predecessors: readonly Set<number>[],
  done: ReadonlySet<number>,
): string[] {
  const path: number[] = [];
  let current = plugins.findIndex((_, i) => !done.has(i));
  while (!path.includes(current)) {
    path.push(current);
    const before = [...(predecessors[current] ?? [])]
      .filter((j) => !done.has(j))
      .sort((a, b) => a - b);
    current = before[0] ?? current;
  }
  const cycle = path.slice(path.indexOf(current));
  cycle.push(current);
  return cycle.map((i) => plugins[i]?.name ?? '?');
}
