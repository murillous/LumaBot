import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TEMPLATE_DIR } from './generate.ts';

// O template fixa versões à mão; estes testes avisam quando o workspace anda e ele fica para trás.

interface Manifest {
  readonly version: string;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

const repo = join(TEMPLATE_DIR, '..', '..', '..');
const template = manifest(join(TEMPLATE_DIR, 'package.json'));

it('as ferramentas do template são as do workspace', () => {
  const root = manifest(join(repo, 'package.json'));
  for (const tool of ['@changesets/cli', 'tsdown', 'typescript', 'vitest']) {
    expect(template.devDependencies?.[tool], tool).toBe(root.devDependencies?.[tool]);
  }
});

it('a faixa do core no template aceita a versão atual dele', () => {
  // `<1.0.0` vale enquanto o core for 0.x (D27). Na 1.0, a faixa do template (peer, dev,
  // `@zapforge/testing` e o `engine` do manifesto) passa a ser `^1.0.0`.
  const { version } = manifest(join(repo, 'packages', 'core', 'package.json'));
  expect(version.startsWith('0.')).toBe(true);
  expect(template.peerDependencies?.['@zapforge/core']).toBe('<1.0.0');
  expect(template.devDependencies?.['@zapforge/core']).toBe('<1.0.0');
  expect(template.devDependencies?.['@zapforge/testing']).toBe('<1.0.0');
  expect(readFileSync(join(TEMPLATE_DIR, 'src', 'index.ts'), 'utf8')).toContain("engine: '<1.0.0'");
});
