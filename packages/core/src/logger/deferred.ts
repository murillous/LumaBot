// Logger que resolve o destino a cada linha (M1-21). O `createBot` entrega um logger à fábrica
// do transport antes de existir o logger real, que só nasce no `start()` (criá-lo antes seria
// efeito colateral, ADR 0004). Este repassa cada chamada ao logger que valer no momento.

import type { LogFields, Logger, LogLevel } from './types.ts';

/** Logger que delega cada chamada a `resolve()`; `child` acumula os bindings sobre o destino. */
export function createDeferredLogger(resolve: () => Logger): Logger {
  return {
    get level(): LogLevel {
      return resolve().level;
    },
    trace: (message, fields) => resolve().trace(message, fields),
    debug: (message, fields) => resolve().debug(message, fields),
    info: (message, fields) => resolve().info(message, fields),
    warn: (message, fields) => resolve().warn(message, fields),
    error: (message, fields) => resolve().error(message, fields),
    fatal: (message, fields) => resolve().fatal(message, fields),
    child: (bindings) => createDeferredLogger(childOf(resolve, bindings)),
  };
}

/** Filho do destino atual, recriado só quando o destino muda: não aloca um logger por linha. */
function childOf(resolve: () => Logger, bindings: LogFields): () => Logger {
  let parent: Logger | undefined;
  let child: Logger | undefined;
  return () => {
    const current = resolve();
    if (current !== parent || child === undefined) {
      parent = current;
      child = current.child(bindings);
    }
    return child;
  };
}
