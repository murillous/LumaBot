import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * Aceite do #121 (ADR 0081): o projeto gerado instala, builda e passa no teste sem edição. Roda
 * o que um autor rodaria, sobre os pacotes como sairiam no npm: empacota o core, o kit de testes
 * e o próprio scaffold (`pnpm pack`, que troca o `workspace:*` pela versão), gera o projeto pelo
 * binário do tarball e instala com o core e o kit apontando para os tarballs. Exige o `pnpm build`
 * antes, como o `pnpm pack`.
 */
const packages = join(import.meta.dirname, '..', '..');
const root = mkdtempSync(join(tmpdir(), 'zapforge-e2e-'));

function sh(command: string, cwd: string): void {
  console.log(`\n$ ${command}  (${cwd})`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function pack(name: string, into: string): string {
  const dir = join(packages, name);
  if (!existsSync(join(dir, 'dist'))) {
    throw new Error(`${dir}/dist não existe: rode \`pnpm build\` na raiz antes do e2e.`);
  }
  const before = new Set(readdirSync(into));
  sh(`pnpm pack --pack-destination "${into}"`, dir);
  const tarball = readdirSync(into).find((file) => !before.has(file));
  if (tarball === undefined) throw new Error(`pnpm pack de ${name} não gerou tarball`);
  // Barra normal: o `file:` do pnpm não aceita a barra invertida do Windows.
  return join(into, tarball).replaceAll('\\', '/');
}

try {
  const packs = join(root, 'packs');
  mkdirSync(packs);
  const core = pack('core', packs);
  const testing = pack('testing', packs);
  const scaffold = pack('create-plugin', packs);

  // Extraído do tarball, o CLI só enxerga o que o `files` publica (dist e template). Caminhos
  // relativos: o tar do Git Bash lê `C:` de um caminho absoluto como host remoto.
  mkdirSync(join(root, 'cli'));
  sh(`tar -xzf "packs/${basename(scaffold)}" -C cli`, root);
  sh('node cli/package/dist/cli.mjs zapforge-plugin-e2e', root);

  const project = join(root, 'zapforge-plugin-e2e');
  // O core e o kit ainda não estão no npm: o override vale também para a dependência do kit no
  // core, e o projeto fica com uma cópia só de cada pacote, como no registry.
  writeFileSync(
    join(project, 'pnpm-workspace.yaml'),
    `overrides:\n  '@zapforge/core': 'file:${core}'\n  '@zapforge/testing': 'file:${testing}'\n`,
  );
  sh('pnpm install', project);
  sh('pnpm run typecheck', project);
  sh('pnpm test', project);
  sh('pnpm run build', project);
  for (const file of ['index.mjs', 'index.d.mts']) {
    if (!existsSync(join(project, 'dist', file))) throw new Error(`build sem dist/${file}`);
  }
  console.log('\ne2e ok: o projeto gerado instalou, passou no typecheck e no teste e buildou.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
