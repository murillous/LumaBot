// Gera a spec e os tipos do cliente: `openapi.json` (core + plugins do app que têm API) e
// `src/lib/api-types.d.ts`. A primeira linha dos tipos leva o hash da spec, que o teste
// `api-types.test.ts` confere: spec nova sem rodar este script falha na CI.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const spec = join(root, 'openapi.json');
const types = join(root, 'src', 'lib', 'api-types.d.ts');
// shell: no Windows o `pnpm` é um .cmd.
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

run('pnpm', ['exec', 'bridger', 'openapi', '../src/api-plugins.ts', '--out', 'openapi.json']);
// O openapi-typescript roda isolado em TypeScript 5 (não é dependência do core).
run('pnpm', [
  'dlx',
  '--package',
  'typescript@5',
  '--package',
  'openapi-typescript@7.13.0',
  'openapi-typescript',
  'openapi.json',
  '-o',
  'src/lib/api-types.d.ts',
]);

const hash = createHash('sha256')
  .update(readFileSync(spec, 'utf8').replaceAll('\r\n', '\n'))
  .digest('hex');
writeFileSync(types, `// spec-sha256: ${hash}\n${readFileSync(types, 'utf8')}`);
