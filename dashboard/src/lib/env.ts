/** O mínimo do `EventSource` que o app usa; o teste troca por um falso. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
}

/** Tudo o que o app recebe de fora: onde está a API e como falar com ela. */
export interface AppEnv {
  /** Origem das rotas `/api/...`. O proxy do Vite as repassa ao bot, então é a do próprio app. */
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly openEvents: (url: string) => EventSourceLike;
}

export function browserEnv(): AppEnv {
  return {
    baseUrl: location.origin,
    // `fetch` solto perde o `this` (Illegal invocation) quando chamado como método do objeto.
    fetch: (input, init) => fetch(input, init),
    // Mesma origem: o cookie da sessão vai sozinho; o EventSource não manda header.
    openEvents: (url) => new EventSource(url),
  };
}
