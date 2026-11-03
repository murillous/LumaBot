// Sobe o bot (build em `dist/`) e o `vite preview` do dashboard juntos, para o primeiro boot ser
// um comando só. O `pnpm start` continua sendo só o bot (serviço, systemd). Sem dependência de
// orquestrador: dois filhos com a saída herdada e um supervisor pequeno.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type AppConfig, fontconfigRelaunchEnv, loadConfig, pluginEnv } from '#config.ts';

/** O mínimo que o supervisor precisa de um processo; o `ChildProcess` cumpre e o teste finge. */
export interface Supervised {
  readonly name: string;
  /** Derruba o processo (e, se houver, os filhos dele). */
  stop(): void;
  /** Chama `cb` com o código de saída (`null` quando morreu por sinal). */
  onExit(cb: (code: number | null) => void): void;
}

/**
 * Espera todos terminarem; quando o primeiro termina, derruba os outros (cascata) e o código é o
 * desse primeiro (1 se foi por sinal). Se o fim foi pedido (`request`, por Ctrl+C ou SIGTERM), vale
 * o código do bot, o primeiro da lista, que é quem o chamador espera. `killChildren: false` só
 * marca o pedido, para quando o terminal já entregou o sinal aos filhos.
 */
export function supervise(procs: readonly Supervised[]): {
  done: Promise<number>;
  request: (killChildren: boolean) => void;
} {
  let requested = false;
  let cascading = false;
  const exited = new Set<Supervised>();
  const stopRunning = () => {
    for (const p of procs) if (!exited.has(p)) p.stop();
  };
  const request = (killChildren: boolean) => {
    requested = true;
    if (killChildren) stopRunning();
  };
  const done = new Promise<number>((resolveDone) => {
    let result: number | undefined;
    for (const proc of procs) {
      proc.onExit((code) => {
        // `exit` e `error` do mesmo filho podem vir os dois.
        if (exited.has(proc)) return;
        exited.add(proc);
        if (result === undefined || (requested && proc === procs[0])) result = code ?? 1;
        if (!requested && !cascading) {
          cascading = true;
          stopRunning();
        }
        if (exited.size === procs.length) resolveDone(result);
      });
    }
  });
  return { done, request };
}

/**
 * `LUMA_BOT_URL` do Vite: onde o proxy encontra a API. Host de escuta `0.0.0.0` não é endereço
 * para conectar, então vira loopback.
 */
export function botUrl(api: NonNullable<AppConfig['dashboard']>): string {
  const host = api.hostname === '0.0.0.0' ? '127.0.0.1' : api.hostname;
  return `http://${host}:${api.port}`;
}

const STOP_GRACE_MS = 5000;

function child(
  name: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
): Supervised {
  // Sem shell: o filho é o próprio node (no Windows, um `pnpm.cmd` deixaria neto vivo).
  const proc: ChildProcess = spawn(process.execPath, args, { cwd, stdio: 'inherit', env });
  return {
    name,
    stop: () => {
      if (proc.pid === undefined || proc.exitCode !== null) return;
      if (process.platform !== 'win32') {
        proc.kill('SIGTERM');
        return;
      }
      // No Windows `kill` mata só o filho direto, e o `main.ts` relança o bot como neto (para o
      // FONTCONFIG_FILE): o neto ficaria órfão segurando a porta e a sessão. `taskkill /T` leva a
      // árvore; sem `/F` o bot ainda pode drenar, e o `/F` entra se ele não sair a tempo.
      const pid = String(proc.pid);
      spawn('taskkill', ['/T', '/PID', pid], { stdio: 'ignore' }).on('error', () => {
        proc.kill();
      });
      const timer = setTimeout(() => {
        spawn('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'ignore' }).on('error', () => {
          proc.kill();
        });
      }, STOP_GRACE_MS);
      timer.unref();
      proc.once('exit', () => clearTimeout(timer));
    },
    onExit: (cb) => {
      proc.once('exit', (code) => cb(code));
      proc.once('error', (err) => {
        // Não subiu: vale como saída com erro.
        process.stderr.write(`start:all: ${name} não iniciou: ${err.message}\n`);
        cb(1);
      });
    },
  };
}

function main(): Promise<number> | number {
  const root = resolve(import.meta.dirname, '..');
  const dashboardDir = join(root, 'dashboard');
  const vite = join(dashboardDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const bot = join(root, 'dist', 'main.mjs');

  const missing = [bot, join(dashboardDir, 'dist'), vite].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    process.stderr.write(
      `start:all: faltam ${missing.join(', ')}. Rode \`pnpm install\` e \`pnpm build\` antes.\n`,
    );
    return 1;
  }

  const { dashboard: api } = loadConfig();
  if (!api) {
    process.stderr.write(
      'start:all: LUMABOT_DASHBOARD_PORT=off desliga a API, e sem API não há dashboard.\n',
    );
    return 1;
  }

  // O mesmo ambiente que o `main.ts` monta para relançar o bot no Windows (FONTCONFIG_FILE): com
  // ele o `main.ts` não relança, e o bot é filho direto, que o kill do start:all alcança.
  const botEnv = fontconfigRelaunchEnv(join(root, 'fontconfig', 'windows.conf'));
  const viteEnv = { ...pluginEnv(), LUMA_BOT_URL: botUrl(api) };

  const { done, request } = supervise([
    child('bot', ['--env-file-if-exists=.env', bot], root, botEnv),
    // O Vite roda do pacote do dashboard (config, proxy e `dist/` ficam lá).
    child('dashboard', [vite, 'preview'], dashboardDir, viteEnv),
  ]);
  // No Windows o Ctrl+C do console já chega a todos os processos; matar o bot aqui pularia o
  // `bot.stop()` dele. Só esperamos. Nos outros SOs o SIGTERM vem só para este processo.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => request(process.platform !== 'win32'));
  }
  return done;
}

// Só roda como script; o teste importa o módulo sem subir nada. (`import.meta.main` só existe a
// partir do Node 24.2.)
if (resolve(import.meta.filename) === resolve(process.argv[1] ?? '')) {
  process.exitCode = await main();
}
