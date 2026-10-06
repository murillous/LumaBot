/**
 * Gancho executado no `stop()`, antes de desconectar o transport. É por aqui que filas drenam
 * e plugins fazem `teardown`. O `signal` aborta quando o gancho estoura o prazo, para quem
 * quiser parar de trabalhar em vez de continuar rodando órfão depois do timeout.
 */
export type StopHook = (signal: AbortSignal) => void | Promise<void>;

export interface StopHookOptions {
  /** Nome que aparece nos erros. Padrão: o nome da função, ou `anonimo`. */
  readonly name?: string;
  /** Prazo deste gancho em ms. Padrão: `shutdown.hookTimeoutMs` do bot. */
  readonly timeoutMs?: number;
}

export interface ShutdownOptions {
  /** Prazo padrão de cada gancho em ms. Padrão: 5000. */
  readonly hookTimeoutMs?: number;
  /** Prazo total dos ganchos em ms. Padrão: 15000. */
  readonly timeoutMs?: number;
}

/** Falha de um gancho de parada; o erro original fica em `cause`. */
export class StopHookError extends Error {
  readonly hookName: string;
  /** `true` quando o gancho estourou o prazo ou nem rodou porque o prazo total acabou. */
  readonly timedOut: boolean;

  constructor(hookName: string, message: string, timedOut: boolean, cause?: unknown) {
    super(`gancho de parada "${hookName}": ${message}`, { cause });
    this.name = 'StopHookError';
    this.hookName = hookName;
    this.timedOut = timedOut;
  }
}

export interface RegisteredStopHook {
  readonly hook: StopHook;
  readonly name: string;
  readonly timeoutMs: number | undefined;
}

export const DEFAULT_HOOK_TIMEOUT_MS = 5000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Roda os ganchos em sequência, na ordem recebida, e devolve as falhas em vez de lançar: um
 * gancho quebrado não pode impedir o teardown dos outros. Quem chama decide o destino dos erros.
 */
export async function runStopHooks(
  hooks: readonly RegisteredStopHook[],
  options: ShutdownOptions = {},
): Promise<StopHookError[]> {
  const hookTimeoutMs = options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
  const errors: StopHookError[] = [];

  for (const entry of hooks) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // Prazo total esgotado: o processo precisa encerrar mesmo com ganchos pendentes.
      errors.push(new StopHookError(entry.name, 'não executado: prazo total esgotado', true));
      continue;
    }
    const error = await runOne(entry, Math.min(entry.timeoutMs ?? hookTimeoutMs, remaining));
    if (error) errors.push(error);
  }
  return errors;
}

async function runOne(
  entry: RegisteredStopHook,
  timeoutMs: number,
): Promise<StopHookError | undefined> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<StopHookError>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(new StopHookError(entry.name, `excedeu ${timeoutMs} ms`, true));
    }, timeoutMs);
  });
  // `then` captura também o throw síncrono do gancho.
  const run = Promise.resolve()
    .then(() => entry.hook(controller.signal))
    .then(
      () => undefined,
      (cause: unknown) => new StopHookError(entry.name, 'falhou', false, cause),
    );
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
