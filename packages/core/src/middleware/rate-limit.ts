import type { MessageContext } from '#context.ts';
import type { Middleware } from './pipeline.ts';

export interface RateLimiterOptions {
  /** Máximo de ocorrências por chave dentro de uma janela. */
  readonly max: number;
  /** Duração da janela fixa, em ms. */
  readonly windowMs: number;
  /** Relógio em ms. Padrão `performance.now` (monotônico: não volta com ajuste de hora). */
  readonly clock?: () => number;
}

interface Window {
  readonly start: number;
  count: number;
}

/**
 * Contador de janela fixa por chave. As janelas vencidas são removidas a cada `hit`, então a
 * memória fica limitada às chaves ativas na última janela — o `rateLimiter` do LumaBot nunca
 * limpava o `Map` e crescia com cada contato visto (débito #7 do plano).
 */
export class RateLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #clock: () => number;
  // Ordem de inserção = ordem de início da janela: uma janela vencida sai do Map antes de a
  // chave abrir outra, então a varredura para na primeira janela ainda válida.
  readonly #windows = new Map<string, Window>();

  constructor(options: RateLimiterOptions) {
    if (!Number.isInteger(options.max) || options.max < 1) {
      throw new RangeError(`max deve ser um inteiro >= 1: ${options.max}`);
    }
    if (!(options.windowMs > 0)) {
      throw new RangeError(`windowMs deve ser > 0: ${options.windowMs}`);
    }
    this.#max = options.max;
    this.#windowMs = options.windowMs;
    this.#clock = options.clock ?? (() => performance.now());
  }

  /** Conta uma ocorrência da chave; `false` se ela estourou o limite da janela atual. */
  hit(key: string): boolean {
    const now = this.#clock();
    this.#sweep(now);
    const window = this.#windows.get(key);
    if (window === undefined) {
      this.#windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count++;
    return window.count <= this.#max;
  }

  /** Chaves com janela aberta. */
  get size(): number {
    return this.#windows.size;
  }

  #sweep(now: number): void {
    for (const [key, window] of this.#windows) {
      if (now - window.start < this.#windowMs) return;
      this.#windows.delete(key);
    }
  }
}

/** Por quem a mensagem é contada: remetente (em qualquer chat), chat, ou remetente em cada chat. */
export type RateLimitScope = 'sender' | 'chat' | 'sender-in-chat';

export interface RateLimitOptions extends RateLimiterOptions {
  /** Padrão `'sender'`. */
  readonly by?: RateLimitScope;
  /** Chamado quando uma mensagem é barrada (ex.: para registrar). Erro aqui propaga ao pipeline. */
  readonly onLimited?: (ctx: MessageContext) => void;
}

const KEYS: Record<RateLimitScope, (ctx: MessageContext) => string> = {
  sender: (ctx) => ctx.message.sender.id,
  chat: (ctx) => ctx.message.chat.id,
  // NUL não aparece em IDs de transport, então não há colisão entre pares diferentes.
  'sender-in-chat': (ctx) => `${ctx.message.chat.id}\u0000${ctx.message.sender.id}`,
};

/** Rate limit de entrada: barra a mensagem quando a chave estoura `max` dentro da janela. */
export function rateLimit(options: RateLimitOptions): Middleware<MessageContext> {
  const limiter = new RateLimiter(options);
  const keyOf = KEYS[options.by ?? 'sender'];
  const onLimited = options.onLimited;
  return (ctx, next) => {
    if (limiter.hit(keyOf(ctx))) return next();
    onLimited?.(ctx);
    return undefined;
  };
}
