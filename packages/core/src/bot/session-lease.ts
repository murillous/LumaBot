// Trava da sessão entre processos (ADR 0074). O `claimSession` só enxerga bots no mesmo objeto de
// storage; dois processos sobre o mesmo banco se veem só por aqui. Nem toda plataforma derruba a
// conexão antiga (o Discord aceita o mesmo token em vários gateways), então sem a trava os dois
// responderiam. A trava é por nome de sessão, sem olhar o transport: plataformas diferentes com o
// mesmo nome dividiriam o KV, os jobs e o auth state.

import { randomUUID } from 'node:crypto';
import { BotConfigError } from '#config/owners.ts';
import type { Logger } from '#logger/types.ts';
import type { StoragePort } from '#storage/types.ts';

/** Validade da trava: por quanto tempo a sessão de um processo que caiu fica presa. */
export const SESSION_LEASE_TTL_MS = 30_000;
/** Intervalo da renovação e das tentativas do `start()`: três chances antes de a trava vencer. */
export const SESSION_LEASE_RENEW_MS = 10_000;

export interface SessionLeaseOptions {
  readonly storage: StoragePort;
  readonly session: string;
  readonly log: Logger;
  /** Aborta a espera pela trava (`stop()` durante o `start()`); rejeita com o `reason`. */
  readonly signal: AbortSignal;
  /** Outro processo assumiu a trava com o bot rodando. Chamado uma vez; a renovação para. */
  readonly onLost: () => void;
}

export interface SessionLease {
  /** Para a renovação, espera a que estiver em andamento e libera a trava. */
  release(): Promise<void>;
}

/**
 * Adquire a trava da sessão e a renova até o `release()`. Ocupada, tenta de novo por até uma
 * validade inteira: a trava de um processo que caiu vence nesse prazo, e o restart logo depois do
 * crash sobe sozinho. Lança `BotConfigError` se outro processo ainda a tem depois disso. Storage
 * sem a trava (memória, que vive num processo só) devolve `undefined`, sem timer.
 */
export async function acquireSessionLease(
  options: SessionLeaseOptions,
): Promise<SessionLease | undefined> {
  const { storage, session, log, signal, onLost } = options;
  const { acquireLease, releaseLease } = storage;
  if (acquireLease === undefined || releaseLease === undefined) return undefined;
  const name = `session:${session}`;
  const owner = randomUUID();
  const acquire = (): Promise<boolean> =>
    acquireLease.call(storage, name, owner, SESSION_LEASE_TTL_MS);

  for (let waited = 0; !(await acquire()); waited += SESSION_LEASE_RENEW_MS) {
    if (waited >= SESSION_LEASE_TTL_MS) {
      throw new BotConfigError(
        `sessão "${session}" já está em uso por outro processo neste storage: cada sessão ` +
          'roda num processo só; dê um `session` diferente a cada bot (inclusive em plataformas ' +
          'diferentes)',
      );
    }
    if (waited === 0) {
      log.warn('sessão travada por outro processo; esperando a trava vencer', {
        session,
        ttlMs: SESSION_LEASE_TTL_MS,
      });
    }
    await abortableDelay(SESSION_LEASE_RENEW_MS, signal);
  }

  let lost = false;
  let renewing: Promise<void> | undefined;
  const renew = async (): Promise<void> => {
    try {
      if (await acquire()) return;
      lost = true;
      clearInterval(timer);
      onLost();
    } catch (error) {
      // Falha de I/O não é perda: a trava vale por mais duas renovações, e o próximo tick tenta.
      log.warn('falha ao renovar a trava da sessão; tentando no próximo intervalo', {
        session,
        err: error,
      });
    }
  };
  const timer = setInterval(() => {
    // Uma renovação por vez: um storage lento não empilha escritas.
    renewing ??= renew().finally(() => {
      renewing = undefined;
    });
  }, SESSION_LEASE_RENEW_MS);
  // Não segura o processo: quem o mantém vivo é o transport.
  timer.unref?.();

  return {
    async release(): Promise<void> {
      clearInterval(timer);
      // Uma renovação que terminasse depois da liberação adquiriria a trava de novo.
      await renewing;
      if (!lost) await releaseLease.call(storage, name, owner);
    },
  };
}

/** Espera `ms`, ou rejeita com `signal.reason` se o sinal abortar antes. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
