/**
 * Versão do `@zapforge/core`, contra a qual o loader confere o `engine` dos plugins. Fica numa
 * constante (e não lida do `package.json` em runtime) para valer igual no fonte e no bundle; o
 * `version.test.ts` falha se ela divergir do `package.json`, então o PR de versão do changesets
 * precisa atualizá-la junto.
 */
export const CORE_VERSION = '0.0.0';
