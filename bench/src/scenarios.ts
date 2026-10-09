// Os 5 cenários do plano §7 (D30). Cada um sobe o bot de referência e devolve uma medida. O
// runner (`main.ts`) roda cada execução num processo novo: memória e boot dependem de o processo
// não ter carregado nada antes.

import { setImmediate as nextTick } from 'node:timers/promises';
import { collectGarbage, MB, median, percentile } from './stats.ts';
import { createWorkload, messageAt, repliesOf, type Workload } from './workload.ts';

export interface Scenario {
  readonly name: ScenarioName;
  readonly description: string;
  readonly unit: string;
  /** A meta: `max` é teto (menor é melhor), `min` é piso (maior é melhor). */
  readonly target: { readonly max: number } | { readonly min: number };
  /** Execuções, cada uma num processo; o resultado é a mediana. */
  readonly runs: number;
  /**
   * Se o CI barra piora > 10% sobre o baseline. Desligado onde a medida fica perto de zero e a
   * piora relativa seria só ruído; aí vale só a meta (ADR 0054).
   */
  readonly checksRegression: boolean;
  readonly run: () => Promise<number>;
}

export type ScenarioName = 'overhead' | 'throughput' | 'idle-memory' | 'memory-growth' | 'boot';

export interface OverheadOptions {
  readonly warmup?: number;
  readonly messages?: number;
}

/**
 * Overhead do kernel por mensagem, em ms (p99): do `emit` do transport até o bot assentar, uma
 * mensagem por vez. Inclui middlewares, roteamento, listeners e a fila de saída até o
 * `FakeTransport`.
 */
export async function overhead(options: OverheadOptions = {}): Promise<number> {
  const { warmup = 5_000, messages = 20_000 } = options;
  const workload = await createWorkload();
  const { bot } = workload;
  const latencies: number[] = [];
  let replies = 0;
  for (let i = 0; i < warmup + messages; i++) {
    const start = performance.now();
    bot.transport.emit('message', messageAt(i));
    await bot.bot.settled();
    const elapsed = performance.now() - start;
    if (i >= warmup) latencies.push(elapsed);
    replies += bot.sent.length;
    bot.transport.clear();
  }
  await finish(workload, warmup + messages, replies);
  return percentile(latencies, 99);
}

export interface ThroughputOptions {
  readonly warmup?: number;
  readonly messages?: number;
}

/**
 * Vazão em msg/s: rajadas em todos os chats ao mesmo tempo, esperando o bot assentar entre uma e
 * outra (a fila de entrada aceita até 100 pendentes por chat).
 */
export async function throughput(options: ThroughputOptions = {}): Promise<number> {
  // Aquecimento fora da medida: o JIT ainda não otimizou o caminho nas primeiras mensagens.
  const { warmup = 20_000, messages = 200_000 } = options;
  const workload = await createWorkload();
  const warmupReplies = await drive(workload, 0, warmup);
  const start = performance.now();
  const replies = await drive(workload, warmup, messages);
  const seconds = (performance.now() - start) / 1000;
  await finish(workload, warmup + messages, warmupReplies + replies);
  return messages / seconds;
}

/** Memória do processo (RSS, MB) com o bot de referência no ar e ocioso. */
export async function idleMemory(): Promise<number> {
  const workload = await createWorkload();
  // Um ciclo do event loop para timers e promises do boot assentarem antes da leitura.
  await nextTick();
  collectGarbage();
  const rss = process.memoryUsage().rss / MB;
  await finish(workload, 0, 0);
  return rss;
}

export interface MemoryGrowthOptions {
  readonly warmup?: number;
  readonly messages?: number;
}

/**
 * Crescimento do heap (MB) depois de `messages` mensagens, comparado ao fim do aquecimento. Cada
 * mensagem tem remetente novo, então estado por remetente ou por mensagem que não se limpa cresce
 * com a carga.
 */
export async function memoryGrowth(options: MemoryGrowthOptions = {}): Promise<number> {
  const { warmup = 100_000, messages = 1_000_000 } = options;
  const workload = await createWorkload();
  let replies = await drive(workload, 0, warmup);
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  replies += await drive(workload, warmup, messages);
  collectGarbage();
  const after = process.memoryUsage().heapUsed;
  await finish(workload, warmup + messages, replies);
  return (after - before) / MB;
}

/** Boot em ms: do `createBot` ao fim do `start()`, com os 20 plugins, num processo frio. */
export async function boot(): Promise<number> {
  const start = performance.now();
  const workload = await createWorkload();
  const elapsed = performance.now() - start;
  await finish(workload, 0, 0);
  return elapsed;
}

/** Rajada: uma mensagem por chat por vez, até 10 por chat antes de esperar o bot assentar. */
const BURST = 5_000;

/** Entrega `count` mensagens a partir da `from` e devolve quantas respostas o bot enviou. */
async function drive(workload: Workload, from: number, count: number): Promise<number> {
  const { bot } = workload;
  let replies = 0;
  for (let i = from; i < from + count; i += BURST) {
    const end = Math.min(i + BURST, from + count);
    for (let j = i; j < end; j++) bot.transport.emit('message', messageAt(j));
    await bot.bot.settled();
    replies += bot.sent.length;
    // O `FakeTransport` guarda cada envio; sem limpar, a memória mediria o registro dele.
    bot.transport.clear();
  }
  return replies;
}

/**
 * Para o bot e confere que a carga rodou como esperado. Mensagem descartada, erro de plugin ou
 * resposta faltando mudam o que está sendo medido, então o cenário falha em vez de reportar.
 */
async function finish(workload: Workload, messages: number, replies: number): Promise<void> {
  const { bot } = workload;
  const { inbound, outbound } = bot.bot.stats();
  const transportErrors = bot.transport.errors.length;
  await bot.stop();
  let expected = 0;
  for (let i = 0; i < messages; i++) expected += repliesOf(i);
  const problems = [
    inbound.processed !== messages && `processadas ${inbound.processed} de ${messages}`,
    inbound.dropped > 0 && `${inbound.dropped} descartadas na entrada`,
    inbound.errors > 0 && `${inbound.errors} erros de middleware`,
    workload.pluginErrors() > 0 && `${workload.pluginErrors()} plugin.error`,
    transportErrors > 0 && `${transportErrors} erros nos handlers do transport`,
    outbound.failed + outbound.dropped > 0 &&
      `${outbound.failed + outbound.dropped} envios perdidos`,
    replies !== expected && `${replies} respostas, esperava ${expected}`,
  ].filter((problem) => problem !== false);
  if (problems.length > 0) {
    throw new Error(`a carga do benchmark não rodou como esperado: ${problems.join('; ')}`);
  }
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'overhead',
    description: 'Overhead do kernel por mensagem (p99)',
    unit: 'ms',
    target: { max: 1 },
    runs: 3,
    checksRegression: true,
    run: () => overhead(),
  },
  {
    name: 'throughput',
    description: 'Vazão sintética em 500 chats',
    unit: 'msg/s',
    target: { min: 5_000 },
    runs: 3,
    checksRegression: true,
    run: () => throughput(),
  },
  {
    name: 'idle-memory',
    description: 'Memória ociosa (RSS)',
    unit: 'MB',
    target: { max: 80 },
    runs: 3,
    checksRegression: true,
    run: idleMemory,
  },
  {
    name: 'memory-growth',
    description: 'Crescimento do heap após 1M mensagens',
    unit: 'MB',
    // "~0" do plano: um objeto de 50 bytes retido por mensagem já dá ~48 MB em 1M.
    target: { max: 5 },
    runs: 1,
    // Perto de 0 (até negativo), 10% do baseline é menos que o ruído do heap: a meta já é a régua.
    checksRegression: false,
    run: () => memoryGrowth(),
  },
  {
    name: 'boot',
    description: 'Boot com 20 plugins',
    unit: 'ms',
    target: { max: 500 },
    runs: 5,
    checksRegression: true,
    run: boot,
  },
];

/** Mediana das execuções e se ela cumpre a meta. */
export function evaluate(
  scenario: Pick<Scenario, 'target'>,
  values: readonly number[],
): { readonly value: number; readonly ok: boolean } {
  const value = median(values);
  const ok = 'max' in scenario.target ? value < scenario.target.max : value >= scenario.target.min;
  return { value, ok };
}
