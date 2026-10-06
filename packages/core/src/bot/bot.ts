import type { Transport } from '#transport/types.ts';
import {
  type RegisteredStopHook,
  runStopHooks,
  type ShutdownOptions,
  type StopHook,
  type StopHookOptions,
} from './stop-hooks.ts';

/**
 * Ciclo de vida: `idle → starting → running → stopping → stopped`. `stopped` é terminal —
 * uma instância não reinicia; para subir de novo, crie outro `Bot`.
 */
export type BotState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

export interface BotConfig {
  readonly transport: Transport;
  readonly shutdown?: ShutdownOptions;
}

export interface Bot {
  readonly state: BotState;
  /**
   * Conecta o transport. Idempotente enquanto `starting`/`running` (devolve a mesma promise);
   * rejeita com `BotStateError` depois de `stop()`.
   */
  start(): Promise<void>;
  /**
   * Shutdown gracioso: roda os ganchos de parada (LIFO) e desconecta o transport. Idempotente:
   * chamadas repetidas devolvem a mesma promise. Rejeita com `AggregateError` se algum gancho
   * ou o `disconnect` falhar — mas sempre termina em `stopped`.
   */
  stop(): Promise<void>;
  /** Registra um gancho de parada; devolve a função que o remove. */
  onStop(hook: StopHook, options?: StopHookOptions): () => void;
}

/** Operação incompatível com o estado atual do bot. */
export class BotStateError extends Error {
  readonly state: BotState;

  constructor(message: string, state: BotState) {
    super(message);
    this.name = 'BotStateError';
    this.state = state;
  }
}

/** Cria um bot. Não conecta nem agenda nada: o efeito começa em `start()`. */
export function createBot(config: BotConfig): Bot {
  const { transport } = config;
  // Todo o estado vive neste closure (ADR 0004): duas instâncias nunca se enxergam.
  const hooks: RegisteredStopHook[] = [];
  let state: BotState = 'idle';
  let stopRequested = false;
  let startPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let stopAfterStart: Promise<void> | undefined;

  function shutdown(disconnect: boolean): Promise<void> {
    shutdownPromise ??= runShutdown(disconnect);
    return shutdownPromise;
  }

  async function runShutdown(disconnect: boolean): Promise<void> {
    state = 'stopping';
    // LIFO: quem subiu por último depende de quem subiu antes, então desce primeiro.
    const errors: unknown[] = await runStopHooks(hooks.toReversed(), config.shutdown);
    hooks.length = 0;
    if (disconnect) {
      try {
        await transport.disconnect();
      } catch (error) {
        errors.push(error);
      }
    }
    state = 'stopped';
    if (errors.length > 0) {
      throw new AggregateError(errors, `stop(): ${errors.length} falha(s) no encerramento`);
    }
  }

  async function runStart(): Promise<void> {
    try {
      await transport.connect();
    } catch (connectError) {
      // Libera o que já foi registrado; o transport pode ter conectado pela metade.
      try {
        await shutdown(true);
      } catch (cleanupError) {
        const cleanup = cleanupError instanceof AggregateError ? cleanupError.errors : [];
        throw new AggregateError(
          [connectError, ...cleanup],
          'start(): falha ao conectar e ao encerrar',
        );
      }
      throw connectError;
    }
    if (stopRequested) {
      // stop() chegou durante o connect: quem chamou stop() conduz o encerramento.
      throw new BotStateError('start(): bot parado durante a inicialização', state);
    }
    state = 'running';
  }

  return {
    get state(): BotState {
      return state;
    },

    start(): Promise<void> {
      switch (state) {
        case 'idle':
          state = 'starting';
          startPromise = runStart();
          return startPromise;
        case 'starting':
        case 'running':
          return startPromise ?? Promise.resolve();
        default:
          return Promise.reject(
            new BotStateError(`start(): bot em "${state}" não reinicia`, state),
          );
      }
    },

    stop(): Promise<void> {
      switch (state) {
        case 'idle':
          return shutdown(false);
        case 'starting': {
          stopRequested = true;
          // Espera o connect assentar (sucesso ou falha) e só então encerra; se o start já
          // encerrou por falha, `shutdown` devolve a mesma promise.
          const afterStart = (): Promise<void> => shutdown(true);
          stopAfterStart ??= (startPromise ?? Promise.resolve()).then(afterStart, afterStart);
          return stopAfterStart;
        }
        case 'running':
          return shutdown(true);
        case 'stopping':
          return stopAfterStart ?? shutdownPromise ?? Promise.resolve();
        case 'stopped':
          return Promise.resolve();
      }
    },

    onStop(hook: StopHook, options: StopHookOptions = {}): () => void {
      if (state === 'stopping' || state === 'stopped') {
        throw new BotStateError(`onStop(): bot em "${state}" não aceita ganchos`, state);
      }
      const entry: RegisteredStopHook = {
        hook,
        name: options.name ?? (hook.name || 'anonimo'),
        timeoutMs: options.timeoutMs,
      };
      hooks.push(entry);
      return () => {
        const index = hooks.indexOf(entry);
        if (index !== -1) hooks.splice(index, 1);
      };
    },
  };
}
