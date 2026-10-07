/**
 * Versão do `@zapforge/core`, contra a qual o loader confere o `engine` dos plugins. Fica numa
 * constante (e não lida do `package.json` em runtime) para valer igual no fonte e no bundle.
 * Não edite à mão: `pnpm version-packages` roda o `changeset version` e reescreve esta linha
 * (`scripts/sync-version.ts`); o `version.test.ts` falha se ela divergir do `package.json`.
 */
export const CORE_VERSION = '0.0.0';
