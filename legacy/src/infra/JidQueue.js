import { Logger } from '../utils/Logger.js';

/**
 * Fila de processamento por JID.
 *
 * Garante que mensagens do mesmo JID sejam processadas em série
 * (sem race condition no histórico), enquanto JIDs diferentes rodam
 * em paralelo — sem nenhum bloqueio global.
 *
 * Uso:
 *   queue.enqueue(jid, () => MessageHandler.process(bot));
 */
export class JidQueue {
  /** @type {Map<string, Promise<void>>} jid → cauda da cadeia de promises */
  #queues = new Map();

  /**
   * Encadeia `fn` na fila do JID informado e retorna a promise resultante.
   * Se nenhuma tarefa estiver rodando para esse JID, `fn` inicia imediatamente.
   * Erros em tarefas anteriores não bloqueiam as subsequentes.
   *
   * @param {string} jid
   * @param {() => Promise<void>} fn
   * @returns {Promise<void>}
   */
  enqueue(jid, fn) {
    const prev = this.#queues.get(jid) ?? Promise.resolve();

    // Garante que erros da tarefa anterior não bloqueiem a próxima
    const next = prev
      .catch(err => Logger.error(`[JidQueue] Erro na fila de ${jid}:`, err))
      .then(fn);

    this.#queues.set(jid, next);

    // Cleanup automático: .then(f, f) evita unhandled rejection ao contrário de .finally(f)
    const cleanup = () => { if (this.#queues.get(jid) === next) this.#queues.delete(jid); };
    next.then(cleanup, cleanup);

    return next;
  }

  /** Número de JIDs com fila ativa (útil em métricas e testes). */
  get activeQueues() {
    return this.#queues.size;
  }
}
