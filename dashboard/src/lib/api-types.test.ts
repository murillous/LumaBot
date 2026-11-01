import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

// Os tipos do cliente saem da spec versionada: spec nova sem `pnpm gen:api` deixaria o dashboard
// com rota ou campo que não existe mais. Mesmo hash do `scripts/gen-api.ts`.
it('api-types.d.ts foi gerado do openapi.json atual', () => {
  const spec = readFileSync(join(root, 'openapi.json'), 'utf8');
  const hash = createHash('sha256').update(spec.replaceAll('\r\n', '\n')).digest('hex');
  const types = readFileSync(join(root, 'src', 'lib', 'api-types.d.ts'), 'utf8');
  expect(types.split('\n')[0], 'rode `pnpm --filter @lumabot/dashboard gen:api`').toBe(
    `// spec-sha256: ${hash}`,
  );
});

it('a spec traz as rotas dos plugins da Luma que o dashboard usa', () => {
  const spec = JSON.parse(readFileSync(join(root, 'openapi.json'), 'utf8')) as {
    paths: Record<string, unknown>;
  };
  expect(Object.keys(spec.paths)).toEqual(
    expect.arrayContaining(['/api/plugins/ai/catalog', '/api/plugins/ai/status']),
  );
});
