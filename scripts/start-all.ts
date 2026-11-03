// Sobe o bot (build em `dist/`) e o `vite preview` do dashboard juntos, para o primeiro boot ser
// um comando só. O `pnpm start` continua sendo só o bot (serviço, systemd). Sem dependência de
// orquestrador: dois filhos com a saída herdada e um supervisor pequeno.

import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';

/** O mínimo que o supervisor precisa de um processo; o `ChildProcess` cumpre e o teste finge. */
export interface Supervised {
  readonly name: string;
  stop(): void;
  /** Chama `cb` com o código de saída (`null` quando morreu por sinal). */
  onExit(cb: (code: number | null) => void): void;
}

/**
 * Espera todos terminarem; quando o primeiro termina, encerra os outros. O código é o do primeiro
 * a sair (1 se foi por sinal). Se o encerramento foi pedido (`stopAll`, por Ctrl+C ou SIGTERM),
 * vale o do bot, o primeiro da lista, que é quem o chamador espera.
 */
export function supervise(procs: readonly Supervised[]): {
  done: Promise<number>;
  stopAll: () => void;
} {
  let stopping = false;
  const stopAll = () => {
    stopping = true;
    for (const p of procs) p.stop();
  };
  const done = new Promise<number>((resolve) => {
    let remaining = procs.length;
    let result: number | undefined;
    for (const proc of procs) {
      let exited = false;
      proc.onExit((code) => {
        // `exit` e `error` do mesmo filho podem vir os dois.
        if (exited) return;
        exited = true;
        if (result === undefined || (stopping && proc === procs[0])) result = code ?? 1;
        if (!stopping) stopAll();
        remaining -= 1;
        if (remaining === 0) resolve(result);
      });
    }
  });
  return { done, stopAll };
}

function child(name: string, args: readonly string[], cwd: string): Supervised {
  // Sem shell: o filho é o próprio node, então o `kill` não deixa neto vivo (no Windows, um
  // `pnpm.cmd` deixaria).
  const proc: ChildProcess = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  return {
    name,
    stop: () => {
      proc.kill('SIGTERM');
    },
    onExit: (cb) => {
      proc.once('exit', (code) => cb(code));
      proc.once('error', (err) => {
        // Não subiu (arquivo ausente, por exemplo): vale como saída com erro.
        process.stderr.write(`start:all: ${name} não iniciou: ${err.message}\n`);
        cb(1);
      });
    },
  };
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..');
  const { done, stopAll } = supervise([
    child('bot', ['--env-file-if-exists=.env', 'dist/main.mjs'], root),
    // O Vite roda do pacote do dashboard (config, proxy e `dist/` ficam lá).
    child(
      'dashboard',
      [join(root, 'dashboard', 'node_modules', 'vite', 'bin', 'vite.js'), 'preview'],
      join(root, 'dashboard'),
    ),
  ]);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stopAll);
  process.exitCode = await done;
}
