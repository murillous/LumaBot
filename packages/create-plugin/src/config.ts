/** Gerenciador de pacotes que rodou o scaffold, para os próximos passos saírem no dele. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const KNOWN: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

/**
 * Lê o `npm_config_user_agent` (`pnpm/12.9.1 npm/? node/v24...`), que `npm create`, `pnpm create`,
 * `yarn create` e `bunx` preenchem. Sem ele, ou com um desconhecido, fica o `npm`.
 */
export function detectPackageManager(
  userAgent: string | undefined = process.env['npm_config_user_agent'],
): PackageManager {
  const name = userAgent?.split('/', 1)[0];
  return KNOWN.find((pm) => pm === name) ?? 'npm';
}
