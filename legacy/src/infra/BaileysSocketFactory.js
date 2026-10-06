import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';

/**
 * Carrega estado de autenticação e busca a versão mais recente do protocolo Baileys.
 *
 * @param {object} config - CONFIG de constants.js
 * @returns {Promise<{ version: number[], isLatest: boolean, state: object, saveCreds: Function }>}
 */
export async function prepareBaileysSession(config) {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  const { state, saveCreds }  = await useMultiFileAuthState(config.AUTH_DIR);
  return { version, isLatest, state, saveCreds };
}

/**
 * Cria e retorna um socket Baileys configurado e pronto para uso.
 *
 * @param {object} params
 * @param {object}   params.state    - authState retornado por useMultiFileAuthState
 * @param {number[]} params.version  - Versão do protocolo WA
 * @param {object}   params.config   - CONFIG de constants.js
 * @param {string}   params.logLevel - Nível do pino logger
 * @returns {import('@whiskeysockets/baileys').WASocket}
 */
export function createBaileysSocket({ state, version, config, logLevel }) {
  const logger = pino({ level: logLevel });

  return makeWASocket({
    version,
    auth:   state,
    logger,
    browser:                        ['Ubuntu', 'Chrome', '20.0.04'],
    printQRInTerminal:              false,
    defaultQueryTimeoutMs:          config.TIMEOUT_MS,
    connectTimeoutMs:               config.TIMEOUT_MS,
    keepAliveIntervalMs:            config.KEEPALIVE_MS,
    qrTimeout:                      60000,
    retryRequestDelayMs:            2000,
    emitOwnEvents:                  false,
    markOnlineOnConnect:            true,
    syncFullHistory:                false,
    generateHighQualityLinkPreview: false,
    fireInitQueries:                false,
    getMessage:                     async () => undefined,
  });
}
