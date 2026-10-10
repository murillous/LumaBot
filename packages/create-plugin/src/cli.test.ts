import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { type CliIo, run } from './cli.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function io(overrides: Partial<CliIo> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'create-zapforge-plugin-'));
  dirs.push(cwd);
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { cwd, out: (t: string) => out.push(t), err: (t: string) => err.push(t), ...overrides },
  };
}

it('cria a pasta e mostra os próximos passos no gerenciador que rodou', () => {
  const { io: cli, out } = io({ packageManager: 'pnpm' });

  expect(run(['@acme/zapforge-plugin-ola'], cli)).toBe(0);

  expect(existsSync(join(cli.cwd, 'zapforge-plugin-ola', 'src', 'index.ts'))).toBe(true);
  expect(out.join('\n')).toContain('cd zapforge-plugin-ola\n  pnpm install\n  pnpm test');
});

it('sem gerenciador informado, os passos saem com npm', () => {
  const { io: cli, out } = io();

  run(['zapforge-plugin-ola'], cli);

  expect(out.join('\n')).toContain('npm install');
});

it('--help mostra o uso e sai com 0', () => {
  const { io: cli, out } = io();

  expect(run(['--help'], cli)).toBe(0);
  expect(out.join('\n')).toContain('Uso: create-zapforge-plugin');
});

it.each([[[]], [['a', 'b']]])('sem um nome só (%j), mostra o uso e sai com 1', (argv) => {
  const { io: cli, err } = io();

  expect(run(argv, cli)).toBe(1);
  expect(err.join('\n')).toContain('Uso: create-zapforge-plugin');
});

it('opção desconhecida sai com 1 dizendo qual', () => {
  const { io: cli, err } = io();

  expect(run(['--force', 'x'], cli)).toBe(1);
  expect(err.join('\n')).toContain('--force');
});

it('nome inválido sai com 1 e não cria nada', () => {
  const { io: cli, err } = io();

  expect(run(['Ola'], cli)).toBe(1);
  expect(err.join('\n')).toContain('não é um nome de pacote npm válido');
  expect(existsSync(join(cli.cwd, 'Ola'))).toBe(false);
});

it('pasta já ocupada sai com 1', () => {
  const { io: cli, err } = io();
  run(['zapforge-plugin-ola'], cli);

  expect(run(['zapforge-plugin-ola'], cli)).toBe(1);
  expect(err.join('\n')).toContain('já existe e não está vazia');
});
