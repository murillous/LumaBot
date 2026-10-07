import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { syncCoreVersion } from './sync-version.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zapforge-sync-version-'));
  mkdirSync(join(dir, 'src'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (version: string, source: string): void => {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(dir, 'src', 'version.ts'), source);
};
const read = (): string => readFileSync(join(dir, 'src', 'version.ts'), 'utf8');

it('reescreve CORE_VERSION com a versão do package.json, sem tocar no resto', () => {
  write('0.1.0', "/** doc */\nexport const CORE_VERSION = '0.0.0';\n");
  expect(syncCoreVersion(dir)).toBe(true);
  expect(read()).toBe("/** doc */\nexport const CORE_VERSION = '0.1.0';\n");
});

it('não reescreve o arquivo se a versão já bate', () => {
  write('0.1.0', "export const CORE_VERSION = '0.1.0';\n");
  expect(syncCoreVersion(dir)).toBe(false);
});

it('lança se a constante sumiu do arquivo', () => {
  write('0.1.0', 'export const VERSION = 1;\n');
  expect(() => syncCoreVersion(dir)).toThrow(/CORE_VERSION não encontrada/);
});

it('o version-packages da raiz sincroniza depois do changeset version', () => {
  const root = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(root.scripts['version-packages']).toBe(
    'changeset version && node packages/core/scripts/sync-version.ts',
  );
});
