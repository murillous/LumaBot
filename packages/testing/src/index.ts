// Entry `@zapforge/testing`: o kit de testes para autores de plugin (D22). Importar o pacote
// registra os matchers no `expect` do Vitest. O resto vem do entry `/bot`, que não carrega o
// Vitest; os dois exportam o mesmo.

import './matchers.ts';

export * from './bot.ts';
