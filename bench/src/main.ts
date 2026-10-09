// Runner do benchmark: `pnpm bench [--only overhead,boot] [--out resultado.json]
// [--baseline base.json]`. Cada execução de cenário roda num processo novo (`--scenario <nome>`),
// que imprime a medida em JSON.

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { type Comparison, compare, readBaseline, TOLERANCE } from './baseline.ts';
import { evaluate, SCENARIOS, type Scenario } from './scenarios.ts';

const run = promisify(execFile);

/** Resultado de um cenário, como vai para o `--out`. */
export interface ScenarioResult {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly target: Scenario['target'];
  readonly runs: readonly number[];
  readonly value: number;
  readonly ok: boolean;
}

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    baseline: { type: 'string' },
    out: { type: 'string' },
    scenario: { type: 'string' },
  },
});

if (args.scenario === undefined) {
  process.exitCode = await runAll(args.only?.split(','), args.out, args.baseline);
} else {
  const scenario = find(args.scenario);
  process.stdout.write(`${JSON.stringify(await scenario.run())}\n`);
}

async function runAll(
  only: readonly string[] | undefined,
  out: string | undefined,
  baselinePath: string | undefined,
) {
  // Lido antes de medir: um caminho errado falha em segundos, não depois de minutos de benchmark.
  const baseline = baselinePath === undefined ? undefined : await readBaseline(baselinePath);
  const selected = only === undefined ? SCENARIOS : only.map(find);
  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    const runs: number[] = [];
    for (let i = 0; i < scenario.runs; i++) runs.push(await runChild(scenario.name));
    const result = { ...describe(scenario), runs, ...evaluate(scenario, runs) };
    results.push(result);
    process.stdout.write(`${format(result)}\n`);
  }
  if (out !== undefined) {
    const report = { node: process.version, platform: process.platform, arch: process.arch };
    await writeFile(out, `${JSON.stringify({ ...report, results }, null, 2)}\n`);
  }
  let exitCode = 0;
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.stderr.write(`Fora da meta: ${failed.map((result) => result.name).join(', ')}\n`);
    exitCode = 1;
  }
  if (baseline !== undefined) {
    const comparisons = compare(SCENARIOS, results, baseline);
    process.stdout.write(`\nComparação com o baseline (tolerância ${TOLERANCE * 100}%):\n`);
    for (const comparison of comparisons) process.stdout.write(`${formatComparison(comparison)}\n`);
    const regressed = comparisons.filter((comparison) => comparison.regressed);
    if (regressed.length > 0) {
      const names = regressed.map((comparison) => comparison.name).join(', ');
      process.stderr.write(`Regressão > ${TOLERANCE * 100}%: ${names}\n`);
      exitCode = 1;
    }
  }
  return exitCode;
}

async function runChild(name: string): Promise<number> {
  const script = fileURLToPath(import.meta.url);
  // `execArgv` repassa as flags do Node com que o runner foi chamado.
  const { stdout } = await run(process.execPath, [...process.execArgv, script, '--scenario', name]);
  const value: unknown = JSON.parse(stdout);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`cenário ${name} devolveu uma medida inválida: ${stdout.trim()}`);
  }
  return value;
}

function find(name: string): Scenario {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) {
    const names = SCENARIOS.map((candidate) => candidate.name).join(', ');
    throw new Error(`cenário desconhecido: ${name} (existem: ${names})`);
  }
  return scenario;
}

function describe({ name, description, unit, target }: Scenario) {
  return { name, description, unit, target };
}

function format(result: ScenarioResult): string {
  const meta = 'max' in result.target ? `< ${result.target.max}` : `≥ ${result.target.min}`;
  const runs = result.runs.map((value) => round(value)).join(', ');
  const status = result.ok ? 'ok' : 'FORA DA META';
  return `${result.name.padEnd(14)} ${round(result.value)} ${result.unit} (meta ${meta}; execuções: ${runs}) ${status}`;
}

function formatComparison(comparison: Comparison): string {
  const name = comparison.name.padEnd(14);
  if (comparison.baseline === undefined) return `${name} ${round(comparison.value)} (sem baseline)`;
  const values = `${round(comparison.baseline)} → ${round(comparison.value)}`;
  if (comparison.change === undefined) return `${name} ${values} (vale só a meta)`;
  const sign = comparison.change > 0 ? '+' : '';
  const direction = comparison.change > 0 ? 'pior' : 'melhor';
  const change = `${sign}${(comparison.change * 100).toFixed(1)}% ${direction}`;
  return `${name} ${values} (${change}) ${comparison.regressed ? 'REGREDIU' : 'ok'}`;
}

function round(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toPrecision(3);
}
