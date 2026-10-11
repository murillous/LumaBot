import { globSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { publint } from 'publint';
import { formatMessage } from 'publint/utils';

/**
 * Confere os pacotes publicáveis antes do publish (#246): o que o publint pega no tarball
 * (`exports`, `types` e `files` apontando para arquivos que existem) e os metadados que o npm e o
 * pnpm exigem do release. Roda depois do `pnpm build`, porque o publint empacota com `pnpm pack`.
 */
interface Manifest {
  readonly name: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly repository?: { readonly url?: string; readonly directory?: string };
  readonly publishConfig?: { readonly access?: string };
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

// A provenance do npm recusa o publish se o `repository` não for o repositório que rodou o workflow.
const REPOSITORY = 'git+https://github.com/murillous/LumaBot.git';

function metadataProblems(dir: string, manifest: Manifest): string[] {
  const problems: string[] = [];
  if (manifest.license !== 'Apache-2.0') problems.push('license diferente de Apache-2.0');
  if (manifest.repository?.url !== REPOSITORY || manifest.repository.directory !== dir) {
    problems.push(`repository deve ser { url: '${REPOSITORY}', directory: '${dir}' }`);
  }
  if (manifest.publishConfig?.access !== 'public')
    problems.push('publishConfig.access não é public');
  // `workspace:*` vira a versão exata no publish: com o core num patch acima, quem instala fica
  // com duas cópias dele. `workspace:^` vira `^versão`.
  for (const deps of [manifest.dependencies, manifest.peerDependencies]) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      if (range.startsWith('workspace:') && range !== 'workspace:^') {
        problems.push(`${name}: use workspace:^ (está ${range})`);
      }
    }
  }
  return problems;
}

let failed = false;
for (const file of globSync('{packages,plugins}/*/package.json')) {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  if (manifest.private === true) continue;
  const dir = dirname(file).replaceAll('\\', '/');

  const problems = metadataProblems(dir, manifest);
  const { messages, pkg } = await publint({ pkgDir: dir, pack: 'pnpm' });
  for (const message of messages) {
    const text = formatMessage(message, pkg) ?? message.code;
    if (message.type === 'error') problems.push(text);
    else console.warn(`${manifest.name}: [${message.type}] ${text}`);
  }

  if (problems.length > 0) {
    failed = true;
    for (const problem of problems) console.error(`${manifest.name}: ${problem}`);
  } else {
    console.log(`${manifest.name}: ok`);
  }
}
if (failed) process.exitCode = 1;
