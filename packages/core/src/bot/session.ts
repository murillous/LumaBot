// Sessões vivas por storage (ADR 0036): a mesma sessão não roda em dois bots que dividem um
// storage. O registro fica pendurado no próprio objeto do storage, e não num mapa do módulo,
// para não haver estado global (ADR 0004); `Symbol.for` faz duas cópias do core se enxergarem.

import { BotConfigError } from '#config/owners.ts';
import type { StoragePort } from '#storage/types.ts';

const LIVE_SESSIONS = Symbol.for('@zapforge/core/live-sessions');

type Tracked = StoragePort & { [LIVE_SESSIONS]?: Set<string> };

/** Libera a sessão; `true` se nenhum outro bot usa mais o storage (quem libera o fecha). */
export type ReleaseSession = () => boolean;

/**
 * Reserva `session` no storage. Lança `BotConfigError` se outro bot vivo já a usa. Storage que
 * não aceita a marca (objeto congelado) fica sem a checagem: devolve `undefined`.
 */
export function claimSession(storage: StoragePort, session: string): ReleaseSession | undefined {
  const tracked = storage as Tracked;
  let live = tracked[LIVE_SESSIONS];
  if (live === undefined) {
    live = new Set();
    const marked = Reflect.defineProperty(tracked, LIVE_SESSIONS, { value: live });
    if (!marked) return undefined;
  }
  if (live.has(session)) {
    throw new BotConfigError(
      `sessão "${session}" já está em uso por outro bot neste storage: cada sessão (número) ` +
        'roda num bot só; dê um `session` diferente a cada bot',
    );
  }
  live.add(session);
  const sessions = live;
  return () => {
    sessions.delete(session);
    return sessions.size === 0;
  };
}
