// Apoio dos testes de componente: `fetch` falso por rota, `EventSource` falso e o app montado com
// eles, sem rede nem bot.

import { QueryClient } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { App } from '#App.tsx';
import type { AppEnv, EventSourceLike } from '#lib/env.ts';

export interface Reply {
  status?: number;
  body?: unknown;
}
export type Handler = (call: { url: URL; body: unknown }) => Reply;

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

const problem = (status: number, detail: string) => ({
  type: 'about:blank',
  title: 'Erro',
  status,
  detail,
});

/** `EventSource` falso: `emit` entrega um evento como o servidor mandaria. */
export class FakeEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  closed = false;
  readonly url: string;
  readonly #listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    act(() => this.onopen?.(new Event('open')));
  }

  /** Cai a conexão; `readyState` 0 é o browser tentando de novo, 2 é ele desistir. */
  fail(readyState = 0): void {
    this.readyState = readyState;
    act(() => this.onerror?.(new Event('error')));
  }

  emit(type: string, data: unknown): void {
    const message = new MessageEvent<string>(type, { data: JSON.stringify(data) });
    act(() => {
      for (const listener of this.#listeners.get(type) ?? []) listener(message);
    });
  }
}

export const OWNER = {
  id: 'u1',
  kind: 'user' as const,
  name: 'Dona',
  role: 'owner' as const,
  permissions: [
    'connection.read',
    'connection.manage',
    'logs.read',
    'plugins.read',
    'plugins.manage',
    'config.read',
    'config.write',
    'users.manage',
    'keys.manage',
    'audit.read',
    'metrics.read',
  ],
};

/** Só lê logs: sem `connection.read`, `config.read`, `plugins.read` e `audit.read`. */
export const LOG_READER = {
  id: 'u2',
  kind: 'user' as const,
  name: 'Leitora',
  role: 'viewer' as const,
  permissions: ['logs.read'],
};

export interface RenderedApp {
  readonly calls: Call[];
  /** Os handlers em uso; o teste troca um no meio para simular o bot caindo. */
  readonly routes: Record<string, Handler>;
  readonly streams: FakeEventSource[];
  /** O cache de queries do app, para o teste conferir o que foi esquecido. */
  readonly client: QueryClient;
  /** O stream mais recente. */
  stream(): FakeEventSource;
  /** Troca o ator que `GET /api/auth/me` devolve (`null`: sem sessão). */
  signIn(next: object | null): void;
}

/**
 * Monta o app com o ator e as rotas dados. `me: null` deixa deslogado. Rota sem handler responde
 * 404, o que faz o teste falhar alto se o app chamar o que não devia.
 */
export function renderApp({
  me = OWNER,
  routes: given = {},
  path = '/',
}: {
  me?: object | null;
  routes?: Record<string, Handler>;
  path?: string;
} = {}): RenderedApp {
  // Cópia: o teste pode trocar handlers sem mexer no objeto que recebeu.
  const routes = { ...given };
  history.replaceState(null, '', path);
  const calls: Call[] = [];
  const streams: FakeEventSource[] = [];
  let actor = me;
  const defaults: Record<string, Handler> = {
    'GET /api/auth/me': () =>
      actor === null
        ? { status: 401, body: problem(401, 'autenticação necessária') }
        : { body: actor },
    'POST /api/auth/logout': () => ({ status: 204 }),
  };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text === '' ? undefined : JSON.parse(text);
    calls.push({ method: request.method, path: url.pathname, body });
    const key = `${request.method} ${url.pathname}`;
    const reply = (routes[key] ?? defaults[key])?.({ url, body }) ?? {
      status: 404,
      body: problem(404, `sem rota ${key}`),
    };
    const status = reply.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
    });
  };
  const env: AppEnv = {
    baseUrl: 'http://bot.test',
    fetch: fetch as typeof globalThis.fetch,
    openEvents: (url) => {
      const source = new FakeEventSource(url);
      streams.push(source);
      return source;
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  render(<App env={env} queryClient={client} />);
  return {
    calls,
    routes,
    streams,
    client,
    stream: () => {
      const last = streams.at(-1);
      if (last === undefined) throw new Error('nenhum stream aberto');
      return last;
    },
    signIn: (next) => {
      actor = next;
    },
  };
}
