import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generate, PluginNameError, pluginNames, TargetNotEmptyError } from './generate.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-zapforge-plugin-'));
  dirs.push(dir);
  return dir;
}

describe('pluginNames', () => {
  it('tira o prefixo zapforge-plugin- do nome do plugin', () => {
    expect(pluginNames('zapforge-plugin-ola')).toEqual({
      packageName: 'zapforge-plugin-ola',
      pluginName: 'ola',
      exportName: 'ola',
      directory: 'zapforge-plugin-ola',
    });
  });

  it('com escopo, a pasta e o plugin saem sem ele', () => {
    expect(pluginNames('@acme/zapforge-plugin-boas-vindas')).toMatchObject({
      pluginName: 'boas-vindas',
      exportName: 'boasVindas',
      directory: 'zapforge-plugin-boas-vindas',
    });
  });

  it('sem o prefixo, o nome do pacote é o do plugin', () => {
    expect(pluginNames('saudacao-2')).toMatchObject({
      pluginName: 'saudacao-2',
      exportName: 'saudacao2',
    });
  });

  it.each(['Ola', 'meu plugin', '@acme', ''])('recusa o pacote %j', (name) => {
    expect(() => pluginNames(name)).toThrow(PluginNameError);
  });

  it.each(['zapforge-plugin-2fa', 'meu_plugin', 'zapforge-plugin-', 'a--b'])(
    'recusa %j, que não serve de nome de plugin',
    (name) => {
      expect(() => pluginNames(name)).toThrow(/não serve de nome de plugin/);
    },
  );
});

describe('generate', () => {
  it('copia o template com os nomes no lugar dos marcadores', () => {
    const target = join(tempDir(), 'zapforge-plugin-boas-vindas');

    generate(target, pluginNames('@acme/zapforge-plugin-boas-vindas'));

    const index = readFileSync(join(target, 'src', 'index.ts'), 'utf8');
    expect(index).toContain('export const boasVindas: PluginDefinition');
    expect(index).toContain("name: 'boas-vindas'");
    expect(readFileSync(join(target, 'src', 'index.test.ts'), 'utf8')).toContain(
      "import { boasVindas } from './index.ts'",
    );
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('@acme/zapforge-plugin-boas-vindas');
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toContain(
      "import { boasVindas } from '@acme/zapforge-plugin-boas-vindas'",
    );
  });

  it('não deixa marcador para trás', () => {
    const target = join(tempDir(), 'p');

    generate(target, pluginNames('zapforge-plugin-ola'));

    for (const entry of readdirSync(target, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const source = readFileSync(join(entry.parentPath, entry.name), 'utf8');
      expect(source, entry.name).not.toMatch(/__(package|name|export)__/);
    }
  });

  it('o _gitignore vira .gitignore', () => {
    const target = join(tempDir(), 'p');

    generate(target, pluginNames('zapforge-plugin-ola'));

    expect(readdirSync(target)).toContain('.gitignore');
    expect(readdirSync(target)).not.toContain('_gitignore');
  });

  it('aceita pasta que existe vazia', () => {
    const target = join(tempDir(), 'p');
    mkdirSync(target);

    generate(target, pluginNames('zapforge-plugin-ola'));

    expect(readdirSync(target)).toContain('package.json');
  });

  it('recusa pasta com arquivos, sem tocar neles', () => {
    const target = tempDir();
    writeFileSync(join(target, 'package.json'), '{}');

    expect(() => generate(target, pluginNames('zapforge-plugin-ola'))).toThrow(TargetNotEmptyError);
    expect(readFileSync(join(target, 'package.json'), 'utf8')).toBe('{}');
  });
});
