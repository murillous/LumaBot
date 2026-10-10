// Entry `@zapforge/transport-web`: a fábrica que o app passa em `createBot({ transport })`
// (ADR 0037, 0077). A classe fica interna: o transport precisa das rotas HTTP do bot.

import type { Transport, TransportDeps } from '@zapforge/core/adapter';
import { createVerifier } from './jwt.ts';
import { type WebOptions, WebTransport } from './transport.ts';

export type { WebAuth } from './jwt.ts';
export * from './protocol.ts';
export { DEFAULT_MEDIA_MAX_BYTES, type WebOptions } from './transport.ts';

export function web(options: WebOptions): (deps: TransportDeps) => Transport {
  // Config errada falha aqui, no app, antes de qualquer conexão.
  const verify = createVerifier(options.auth);
  const maxBytes = options.media?.maxBytes;
  if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes <= 0)) {
    throw new RangeError(`web: media.maxBytes deve ser inteiro positivo; recebido ${maxBytes}`);
  }
  if (options.tenantClaim === '') throw new TypeError('web: tenantClaim vazio');
  return (deps) => {
    // Na fábrica, o erro vira `BotConfigError` no `createBot`.
    if (deps.http === undefined) {
      throw new TypeError('web: o transport precisa de `http` no createBot (ver createHttp)');
    }
    return new WebTransport(options, verify, deps.http, deps.log);
  };
}
