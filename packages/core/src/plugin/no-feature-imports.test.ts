import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Aceite do M1-8 (ADR 0007): o core não importa nenhuma feature. Features são plugins e entram
// pela config ou por `pluginDirs`; um import de `@zapforge/plugin-*` (ou de qualquer outro
// pacote do workspace) aqui dentro recriaria o registro hardcoded do legacy.
const src = fileURLToPath(new URL('..', import.meta.url));
const packageJson = fileURLToPath(new URL('../../package.json', import.meta.url));

const sources = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.[cm]?ts$/.test(file))
  .map((file) => join(src, file));

const specifiers = (code: string): string[] =>
  [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

it('nenhum arquivo do core importa outro pacote @zapforge/*', () => {
  const offenders = sources.flatMap((file) =>
    specifiers(readFileSync(file, 'utf8'))
      // O próprio pacote (e seus subpaths, ex. `@zapforge/core/storage-contract`) pode aparecer:
      // o teste de side effect o importa pelo nome, e a suíte de contrato o cita no JSDoc.
      .filter(
        (specifier) =>
          specifier.startsWith('@zapforge/') &&
          specifier !== '@zapforge/core' &&
          !specifier.startsWith('@zapforge/core/'),
      )
      .map((specifier) => `${file}: ${specifier}`),
  );
  expect(sources.length).toBeGreaterThan(0);
  expect(offenders).toEqual([]);
});

it('o package.json do core não depende de pacote do workspace', () => {
  const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as Record<string, unknown>;
  const dependencies = ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) =>
    Object.keys((manifest[key] as Record<string, string> | undefined) ?? {}),
  );
  expect(dependencies.filter((name) => name.startsWith('@zapforge/'))).toEqual([]);
});
