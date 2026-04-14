/**
 * Container de Injeção de Dependência.
 *
 * Registra factories por token e resolve instâncias sob demanda.
 * Por padrão, todas as dependências são singletons — a factory é
 * chamada uma única vez e o resultado é reutilizado.
 *
 * @example
 * const container = new Container();
 * container
 *   .register('aiPort', () => new GeminiAdapter({ apiKey: env.GEMINI_API_KEY }))
 *   .register('chatService', (c) => new ChatService({ aiPort: c.get('aiPort') }));
 *
 * const service = container.get('chatService');
 */
export class Container {
  #registry  = new Map(); // token → { factory, singleton }
  #singletons = new Map(); // token → instância já criada

  /**
   * Registra uma factory para um token.
   *
   * @param {string} token - Identificador único da dependência
   * @param {Function} factory - Função que recebe o container e retorna a instância.
   *   A assinatura pode ser `() => instance` ou `(container) => instance`.
   * @param {object}  [options]
   * @param {boolean} [options.singleton=true] - Se true, a factory é chamada apenas uma vez
   * @returns {this} Fluent API — permite encadear `.register().register()`
   */
  register(token, factory, { singleton = true } = {}) {
    if (typeof factory !== 'function') {
      throw new TypeError(`[Container] factory para "${token}" deve ser uma função.`);
    }
    this.#registry.set(token, { factory, singleton });
    return this;
  }

  /**
   * Resolve uma dependência pelo token.
   *
   * @param {string} token
   * @returns {*} A instância resolvida
   * @throws {Error} Se o token não estiver registrado
   */
  resolve(token) {
    const entry = this.#registry.get(token);
    if (!entry) {
      throw new Error(`[Container] Token não registrado: "${token}"`);
    }

    if (entry.singleton) {
      if (!this.#singletons.has(token)) {
        this.#singletons.set(token, entry.factory(this));
      }
      return this.#singletons.get(token);
    }

    return entry.factory(this);
  }

  /**
   * Alias de `resolve` — permite desestruturar dependências no construtor.
   * @param {string} token
   * @returns {*}
   */
  get(token) {
    return this.resolve(token);
  }

  /**
   * Verifica se um token está registrado (sem resolver).
   * @param {string} token
   * @returns {boolean}
   */
  has(token) {
    return this.#registry.has(token);
  }

  /**
   * Retorna a lista de tokens registrados (útil para debug e testes).
   * @returns {string[]}
   */
  registeredTokens() {
    return Array.from(this.#registry.keys());
  }

  /**
   * Limpa singletons já criados sem remover o registro.
   * Útil em testes para forçar recriação das instâncias.
   */
  clearSingletons() {
    this.#singletons.clear();
  }
}
