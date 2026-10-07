// Cancelamento cooperativo (ADR 0033). O JS não mata uma promise: quando o código de um plugin
// estoura o prazo, o kernel só consegue avisá-lo (`signal`) e recusar o que ele tentar fazer
// pelo contexto expirado. `Deadline` guarda esse estado para uma execução — um comando, um
// listener, um job ou o contexto inteiro do plugin.

/**
 * Prazo de uma execução de código de plugin. Quem expira é o dono do timer que já existe (o
 * barramento, o roteador, o scheduler, o host); aqui não há timer.
 */
export class Deadline {
  #expired = false;
  #reason: unknown;
  // Criado só quando alguém lê `signal`: a maioria das execuções nem olha para ele, e o
  // `AbortController` é a parte cara (EventTarget) no caminho quente de cada mensagem.
  #controller: AbortController | undefined;

  /** O prazo estourou (ou o contexto foi descartado). */
  get expired(): boolean {
    return this.#expired;
  }

  /** Motivo da expiração (o erro de timeout); `undefined` enquanto no prazo. */
  get reason(): unknown {
    return this.#reason;
  }

  /** Aborta quando o prazo estoura, com `reason` = o erro de timeout. */
  get signal(): AbortSignal {
    if (this.#controller === undefined) {
      this.#controller = new AbortController();
      if (this.#expired) this.#controller.abort(this.#reason);
    }
    return this.#controller.signal;
  }

  /** Marca como expirado e aborta o `signal`. Só a primeira chamada vale. */
  expire(reason: unknown): void {
    if (this.#expired) return;
    this.#expired = true;
    this.#reason = reason;
    this.#controller?.abort(reason);
  }
}

/**
 * Operação de um contexto expirado: `reply` de um comando ou listener que estourou o prazo, ou
 * `send`/`storage`/`scheduler` de um contexto de plugin descartado. A operação não executa;
 * `cause` é o motivo da expiração (o erro de timeout ou do descarte).
 */
export class ContextExpiredError extends Error {
  override readonly name = 'ContextExpiredError';
  readonly plugin: string;
  /** O que foi recusado: `'reply'`, `'reply.image'`, `'send'`, `'storage.kv.set'`… */
  readonly operation: string;
  /** Dono do contexto: `'comando "ping"'`, `'listener de "message"'`, `'contexto do plugin'`. */
  readonly scope: string;

  constructor(plugin: string, operation: string, scope: string, cause: unknown) {
    super(
      `plugin "${plugin}": ${operation} recusado — ${scope} já expirou (prazo estourado ou ` +
        'contexto descartado). Repasse ctx.signal ao trabalho assíncrono para pará-lo a tempo.',
      { cause },
    );
    this.plugin = plugin;
    this.operation = operation;
    this.scope = scope;
  }
}

/**
 * Chave do `Deadline` de uma execução no objeto de contexto. Simbólica, não `#privada`: as
 * visões por plugin derivam o contexto por `Object.create`, e a chave precisa ser alcançável
 * pela cadeia de protótipos.
 */
export const DEADLINE: unique symbol = Symbol('zapforge.deadline');

export interface WithDeadline {
  readonly [DEADLINE]?: Deadline;
}

/** `Deadline` da execução dona do contexto, se houver. */
export function deadlineOf(ctx: object): Deadline | undefined {
  return (ctx as WithDeadline)[DEADLINE];
}
