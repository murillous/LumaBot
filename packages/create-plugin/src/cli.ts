#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { detectPackageManager, type PackageManager } from './config.ts';
import { generate, PluginNameError, pluginNames, TargetNotEmptyError } from './generate.ts';

const USAGE = `Uso: create-zapforge-plugin <nome-do-pacote>

Cria a pasta do plugin com manifesto, teste, README e changesets.

  npm create zapforge-plugin@latest zapforge-plugin-ola
  pnpm create zapforge-plugin @acme/zapforge-plugin-ola

O nome do plugin é o do pacote sem escopo e sem o prefixo zapforge-plugin- (ola).`;

/** Saída do CLI; o `main` liga ao terminal e os testes capturam. */
export interface CliIo {
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly packageManager?: PackageManager;
}

/** Roda o scaffold e devolve o código de saída. */
export function run(argv: readonly string[], io: CliIo): number {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    // Opção desconhecida: o parseArgs explica qual; o uso mostra as válidas.
    io.err(`${(error as Error).message}\n\n${USAGE}`);
    return 1;
  }
  if (parsed.values.help) {
    io.out(USAGE);
    return 0;
  }
  const [packageName] = parsed.positionals;
  if (packageName === undefined || parsed.positionals.length > 1) {
    io.err(USAGE);
    return 1;
  }

  try {
    const names = pluginNames(packageName);
    generate(resolve(io.cwd, names.directory), names);
    const pm = io.packageManager ?? 'npm';
    io.out(
      `Plugin ${names.pluginName} criado em ${names.directory}/.\n\n` +
        `  cd ${names.directory}\n  ${pm} install\n  ${pm} test\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof PluginNameError || error instanceof TargetNotEmptyError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } },
  });
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    packageManager: detectPackageManager(),
  });
}
