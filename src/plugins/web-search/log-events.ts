import { defineLogEvent } from '@usebridger/core';

// Uma linha por backend tentado. Campos: `kind` (`tavily` ou `native`), `durationMs`, `reason`
// da recusa e `err`. Nunca o termo buscado nem o resultado.

export const SEARCH_DONE = defineLogEvent({
  name: 'web-search.search.done',
  level: 'info',
  message: 'busca respondida',
});

/** Cota do Tavily esgotada ou nenhum modelo com busca nativa: a busca cai para o próximo. */
export const SEARCH_REFUSED = defineLogEvent({
  name: 'web-search.search.refused',
  level: 'warn',
  message: 'backend de busca recusou',
});

export const SEARCH_FAILED = defineLogEvent({
  name: 'web-search.search.failed',
  level: 'error',
  message: 'backend de busca falhou',
});
