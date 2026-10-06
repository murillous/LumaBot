/**
 * Gerenciador de plugins do LumaBot.
 *
 * Responsável por registrar plugins e despachar mensagens/comandos para eles.
 * Cada plugin é uma instância com campos estáticos `commands` e métodos opcionais:
 *   - onCommand(command, bot) — chamado quando um dos comandos do plugin é detectado
 *   - onMessage(bot)          — chamado para mensagens sem comando reconhecido
 *   - onStart()               — chamado na inicialização do bot
 *   - onStop()                — chamado no encerramento do bot
 */
export class PluginManager {
  #plugins = [];
  #commandIndex = new Map();

  /**
   * Registra um plugin. Indexa seus comandos para lookup O(1).
   * @param {object} plugin - Instância do plugin
   * @returns {PluginManager} this (fluent)
   */
  register(plugin) {
    this.#plugins.push(plugin);
    for (const cmd of (plugin.constructor.commands ?? [])) {
      this.#commandIndex.set(cmd, plugin);
    }
    return this;
  }

  /**
   * Despacha uma mensagem para o plugin responsável.
   * Se há comando → chama onCommand do plugin dono do comando.
   * Se não há comando → chama onMessage em todos os plugins (ordem de registro).
   *
   * @param {string|null} command - Comando detectado pelo CommandRouter
   * @param {object} bot - BaileysAdapter
   * @returns {Promise<boolean>} true se algum plugin tratou o comando
   */
  async dispatch(command, bot) {
    if (command) {
      const plugin = this.#commandIndex.get(command);
      if (plugin) {
        await plugin.onCommand(command, bot);
        return true;
      }
    }

    for (const plugin of this.#plugins) {
      if (typeof plugin.onMessage === 'function') {
        await plugin.onMessage(bot);
      }
    }

    return false;
  }

  /** Chama onStart() em todos os plugins que implementam o hook. */
  async startAll() {
    for (const plugin of this.#plugins) {
      if (typeof plugin.onStart === 'function') await plugin.onStart();
    }
  }

  /** Chama onStop() em todos os plugins que implementam o hook. */
  async stopAll() {
    for (const plugin of this.#plugins) {
      if (typeof plugin.onStop === 'function') await plugin.onStop();
    }
  }

  /** Retorna o número de plugins registrados (útil em testes). */
  get size() {
    return this.#plugins.length;
  }

  /** Retorna o plugin responsável por um comando (útil em testes). */
  getPluginForCommand(command) {
    return this.#commandIndex.get(command) ?? null;
  }
}
