import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONSTANT = /export const CORE_VERSION = '[^']*';/;

/**
 * Reescreve `CORE_VERSION` em `src/version.ts` com a versão do `package.json` do pacote. Roda
 * depois do `changeset version` (script `version-packages` da raiz): o changesets sobe só o
 * `package.json`, e sem isto o PR de versão sai com a constante velha e o `version.test.ts`
 * vermelho. Devolve `true` se o arquivo mudou.
 */
export function syncCoreVersion(packageDir: string): boolean {
  const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    version: string;
  };
  const file = join(packageDir, 'src', 'version.ts');
  const source = readFileSync(file, 'utf8');
  // Sem a constante no formato esperado, falhar alto: não substituir nada deixaria o release
  // seguir com a versão errada.
  if (!CONSTANT.test(source)) throw new Error(`CORE_VERSION não encontrada em ${file}`);
  const next = source.replace(CONSTANT, `export const CORE_VERSION = '${version}';`);
  if (next === source) return false;
  writeFileSync(file, next);
  return true;
}

if (import.meta.main) {
  syncCoreVersion(join(import.meta.dirname, '..'));
}
