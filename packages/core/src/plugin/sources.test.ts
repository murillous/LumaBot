import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectPlugins, discoverPlugins, PluginDiscoveryError } from './sources.ts';
import type { PluginDefinition } from './types.ts';

// Módulo de plugin escrito como JS puro: a pasta temporária não enxerga o @zapforge/core.
const pluginSource = (exportName: string, name: string): string =>
  `export const ${exportName} = { name: '${name}', version: '1.0.0', engine: '*', setup() {} };\n`;

let root: string;

function write(path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zapforge-plugins-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discoverPlugins', () => {
  it('lê arquivos e subpastas com index, em ordem alfabética', async () => {
    write('plugins/zeta.mjs', pluginSource('zeta', 'zeta'));
    write('plugins/alpha/index.mjs', pluginSource('alpha', 'alpha'));
    write('plugins/beta.js', pluginSource('beta', 'beta'));
    const found = await discoverPlugins(join(root, 'plugins'));
    expect(found.map((entry) => entry.definition.name)).toEqual(['alpha', 'beta', 'zeta']);
    expect(found[0]?.origin).toBe(join(root, 'plugins', 'alpha', 'index.mjs'));
  });

  it('importa .ts também', async () => {
    write(
      'plugins/typed.ts',
      "export const typed: { name: string; version: string; engine: string; setup(): void } = { name: 'typed', version: '1.0.0', engine: '*', setup() {} };\n",
    );
    const found = await discoverPlugins(join(root, 'plugins'));
    expect(found.map((entry) => entry.definition.name)).toEqual(['typed']);
  });

  it('pega todos os exports que são plugin e conta o mesmo objeto uma vez', async () => {
    write(
      'plugins/multi.mjs',
      `${pluginSource('one', 'one')}${pluginSource('two', 'two')}export const helper = 42;\nexport { one as again };\n`,
    );
    const found = await discoverPlugins(join(root, 'plugins'));
    expect(found.map((entry) => entry.definition.name).sort()).toEqual(['one', 'two']);
  });

  it('ignora _, ., testes, .d.ts e arquivos que não são módulo', async () => {
    write('plugins/_helpers.mjs', 'export const x = 1;\n');
    write('plugins/_lib/util.mjs', 'export const y = 1;\n');
    write('plugins/.hidden.mjs', 'export const z = 1;\n');
    write('plugins/thing.test.mjs', 'throw new Error("não deveria importar");\n');
    write('plugins/types.d.ts', 'export declare const t: number;\n');
    write('plugins/README.md', '# notas\n');
    write('plugins/ok.mjs', pluginSource('ok', 'ok'));
    const found = await discoverPlugins(join(root, 'plugins'));
    expect(found.map((entry) => entry.definition.name)).toEqual(['ok']);
  });

  it('módulo sem plugin é erro', async () => {
    write('plugins/empty.mjs', 'export const nada = 1;\n');
    await expect(discoverPlugins(join(root, 'plugins'))).rejects.toThrow(
      /não exporta nenhum plugin/,
    );
  });

  it('subpasta sem index é erro', async () => {
    write('plugins/solto/main.mjs', pluginSource('solto', 'solto'));
    await expect(discoverPlugins(join(root, 'plugins'))).rejects.toThrow(/subpasta sem index/);
  });

  it('falha de import vira PluginDiscoveryError com a causa', async () => {
    write('plugins/broken.mjs', 'throw new Error("boom");\n');
    const error = await discoverPlugins(join(root, 'plugins')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PluginDiscoveryError);
    expect((error as PluginDiscoveryError).path).toBe(join(root, 'plugins', 'broken.mjs'));
    expect(((error as Error).cause as Error).message).toBe('boom');
  });

  it('pasta inexistente é erro', async () => {
    await expect(discoverPlugins(join(root, 'nao-existe'))).rejects.toThrow(PluginDiscoveryError);
  });
});

describe('collectPlugins', () => {
  it('junta config e pastas no mesmo formato, config primeiro', async () => {
    write('a/x.mjs', pluginSource('x', 'x'));
    write('b/y.mjs', pluginSource('y', 'y'));
    const fromConfig: PluginDefinition = {
      name: 'npm-plugin',
      version: '1.0.0',
      engine: '*',
      setup: () => undefined,
    };
    const entries = await collectPlugins({
      plugins: [fromConfig],
      pluginDirs: ['a', join(root, 'b')],
      cwd: root,
    });
    expect(entries.map((entry) => [entry.definition.name, entry.origin])).toEqual([
      ['npm-plugin', 'config'],
      ['x', join(root, 'a', 'x.mjs')],
      ['y', join(root, 'b', 'y.mjs')],
    ]);
    expect(entries[0]?.definition).toBe(fromConfig);
  });

  it('caminho relativo resolve contra o cwd padrão', async () => {
    write('rel/r.mjs', pluginSource('r', 'r'));
    const entries = await collectPlugins({
      pluginDirs: [relative(process.cwd(), join(root, 'rel'))],
    });
    expect(entries.map((entry) => entry.definition.name)).toEqual(['r']);
  });

  it('sem fontes, lista vazia', async () => {
    expect(await collectPlugins({})).toEqual([]);
  });
});
