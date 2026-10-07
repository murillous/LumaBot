// Entry `@zapforge/transport-baileys`: a fábrica que o app passa em `createBot({ transport })`
// (ADR 0037). A classe fica interna: o transport precisa das dependências do bot.

import type { Transport, TransportDeps } from '@zapforge/core/adapter';
import { Browsers, fetchLatestBaileysVersion, makeWASocket, type WAVersion } from 'baileys';
import { type BaileysDriver, type BaileysPairing, BaileysTransport } from './transport.ts';

export type { BaileysPairing } from './transport.ts';

export interface BaileysOptions {
  /**
   * Como parear quando a sessão não tem credenciais: `'qr'` (padrão) emite `connection.qr`;
   * `{ phone }` pede um código de pareamento para o número (só dígitos, com DDI) e emite
   * `connection.pairing-code`.
   */
  readonly pairing?: BaileysPairing;
  /**
   * Versão do WhatsApp Web a anunciar. Sem ela, o transport busca a mais recente na primeira
   * conexão e, se a busca falhar, usa a que vem com o Baileys.
   */
  readonly version?: WAVersion;
}

export function baileys(options: BaileysOptions = {}): (deps: TransportDeps) => Transport {
  const pairing = options.pairing ?? 'qr';
  // Na fábrica, um número inválido vira `BotConfigError` no `createBot`, antes de qualquer
  // conexão.
  if (pairing !== 'qr' && !/^\d{8,15}$/.test(pairing.phone)) {
    throw new TypeError(
      `baileys: pairing.phone deve ter só dígitos, com DDI (ex.: 5511999999999); recebido "${pairing.phone}"`,
    );
  }
  return (deps) => new BaileysTransport({ pairing, driver: driver(options.version, deps) }, deps);
}

function driver(fixed: WAVersion | undefined, deps: TransportDeps): BaileysDriver {
  let latest: Promise<WAVersion> | undefined;
  return {
    makeSocket: ({ auth, logger, version, cachedGroupMetadata }) =>
      makeWASocket({
        auth,
        logger,
        version,
        cachedGroupMetadata,
        browser: Browsers.ubuntu('Chrome'),
      }),
    version: () => {
      if (fixed) return Promise.resolve(fixed);
      // Uma busca por transport: a versão não muda entre reconexões do mesmo processo.
      latest ??= fetchLatestBaileysVersion().then(({ version, error }) => {
        if (error !== undefined) {
          deps.log.warn('não deu para buscar a versão do WhatsApp Web; usando a do Baileys', {
            err: error,
          });
        }
        return version;
      });
      return latest;
    },
  };
}
