// Cancelamento cooperativo (ADR 0033). O JS não mata uma promise: quando o código de um plugin
// estoura o prazo, o kernel só consegue avisá-lo (`signal`) e recusar o que ele tentar fazer
// pelo contexto expirado. `Deadline` guarda esse estado para uma execução — um comando, um
// listener, um job ou o contexto inteiro do plugin.

/**
 * Prazo de uma execução de código de plugin. Quem expira é o dono do timer que já existe (o
 * barramento, o roteador, o scheduler, o host); aqui não há timer.
 *
 * Com `parent` (o `Deadline` de vida do plugin), a execução expira também quando o pai expira:
 * o descarte do plugin alcança os comandos, listeners e jobs dele ainda em andamento (ADR 0033).
 * O pai não guarda os filhos: `expired` e `reason` consultam o pai na leitura, e o `signal` só o
 * escuta quando alguém o lê — o caminho quente não paga nada a mais.
 */
export class Deadline {
  readonly #parent: Deadline | undefined;
  #expired = false;
  #reason: unknown;
  // Criado só quando alguém lê `signal`: a maioria das execuções nem olha para ele, e o
  // `AbortController` é a parte cara (EventTarget) no caminho quente de cada mensagem.
  #controller: AbortController | undefined;
  #signal: AbortSignal | undefined;

  constructor(parent?: Deadline) {
    this.#parent = parent;
  }

  /** O prazo estourou (ou o contexto foi descartado). */
  get expired(): boolean {
    return this.#expired || this.#parent?.expired === true;
  }

  /** Motivo da expiração (o erro de timeout ou do descarte); `undefined` enquanto no prazo. */
  get reason(): unknown {
    return this.#expired ? this.#reason : this.#parent?.reason;
  }

  /** Aborta quando o prazo estoura (ou o pai expira), com `reason` = o motivo. */
  get signal(): AbortSignal {
    if (this.#signal === undefined) {
      this.#controller = new AbortController();
      if (this.#expired) this.#controller.abort(this.#reason);
      const own = this.#controller.signal;
      // `any` guarda o filho por referência fraca no pai: execuções que terminam não se
      // acumulam no `signal` do plugin.
      this.#signal = this.#parent === undefined ? own : AbortSignal.any([own, this.#parent.signal]);
    }
    return this.#signal;
  }

  /** Marca como expirado e aborta o `signal`. Só a primeira expiração vale, a do pai inclusive. */
  expire(reason: unknown): void {
    if (this.expired) return;
    this.#expired = true;
    this.#reason = reason;
    this.#controller?.abort(reason);
  }
}

/**
 * Uma execução com prazo (comando, listener ou job) estourou o tempo. É o `reason` do `signal`
 * abortado: o plugin distingue timeout de outro motivo com `instanceof` (ADR 0033).
 */
export class ExecutionTimeoutError extends Error {
  override readonly name: string = 'ExecutionTimeoutError';
  readonly plugin: string;
  readonly timeoutMs: number;

  constructor(plugin: string, what: string, timeoutMs: number) {
    super(`${what} do plugin "${plugin}" excedeu ${timeoutMs} ms`);
    this.plugin = plugin;
    this.timeoutMs = timeoutMs;
  }
}

/** Um listener estourou o prazo. Vai em `plugin.error` com `timedOut: true`. */
export class ListenerTimeoutError extends ExecutionTimeoutError {
  override readonly name: string = 'ListenerTimeoutError';
  readonly event: string;

  constructor(plugin: string, event: string, timeoutMs: number) {
    super(plugin, `listener em "${event}"`, timeoutMs);
    this.event = event;
  }
}

/** O handler de um job estourou o prazo. Vai em `plugin.error` com `timedOut: true`. */
export class JobTimeoutError extends ExecutionTimeoutError {
  override readonly name: string = 'JobTimeoutError';
  readonly job: string;

  constructor(plugin: string, job: string, timeoutMs: number) {
    super(plugin, `job "${job}"`, timeoutMs);
    this.job = job;
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

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * Prazos armados de um bot, cada um pela função que o desarma. O JS não mata o handler preso,
 * mas o timer do prazo dele não pode sobreviver ao `stop()`: o shutdown chama `disarmAll`.
 */
export class ArmedTimers {
  readonly #disarms = new Set<() => void>();

  add(disarm: () => void): void {
    this.#disarms.add(disarm);
  }

  delete(disarm: () => void): void {
    this.#disarms.delete(disarm);
  }

  /**
   * Desarma todos. A execução abandonada não assenta: rejeitar viraria `plugin.error` e novos
   * listeners com prazo no meio do shutdown, e ninguém mais espera por ela (a fila de entrada já
   * foi abandonada). O `Deadline` dela já expirou com o descarte do plugin.
   */
  disarmAll(): void {
    for (const disarm of this.#disarms) disarm();
    this.#disarms.clear();
  }
}

/**
 * Corre `result` contra um prazo de `timeoutMs`. Estourado, rejeita com o erro de `onTimeout`
 * (que também é a hora de expirar o `Deadline` da execução); o trabalho não tem como ser
 * cancelado e segue em segundo plano, e uma rejeição dele depois do prazo vai para `onLate`,
 * nunca vira rejeição não tratada. Resultado síncrono passa direto, sem timer: o caminho quente
 * não paga nada (plano §7). O timer fica em `armed` enquanto corre, para o shutdown desarmá-lo.
 */
export function settleWithin(
  result: unknown,
  timeoutMs: number,
  onTimeout: () => Error,
  onLate: (error: unknown) => void,
  armed: ArmedTimers,
): unknown {
  if (!isThenable(result)) return result;
  return new Promise((resolve, reject) => {
    let settled = false;
    const disarm = (): void => {
      settled = true;
      clearTimeout(timer);
      armed.delete(disarm);
    };
    const timer = setTimeout(() => {
      disarm();
      reject(onTimeout());
    }, timeoutMs);
    armed.add(disarm);
    result.then(
      (value) => {
        if (settled) return;
        disarm();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          onLate(error);
          return;
        }
        disarm();
        reject(error);
      },
    );
  });
}
