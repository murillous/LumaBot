import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './api-types.d.ts';
import type { AppEnv } from './env.ts';

export type Schemas = components['schemas'];
export type Problem = Schemas['Problem'];

/** Resposta de erro da API: o status e, quando veio, o problem+json. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;
  constructor(status: number, problem: Problem | undefined) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.status = status;
    this.problem = problem;
  }
}

export interface Api {
  /** Cliente tipado das rotas do core e dos plugins do app (spec versionada). */
  readonly client: Client<paths>;
  /** Chamado em todo 401 fora do login: a sessão acabou e o app volta para a tela de entrada. */
  onUnauthorized(handler: () => void): void;
}

const isProblem = (value: unknown): value is Problem =>
  typeof value === 'object' && value !== null && 'status' in value && 'title' in value;

// O login e o aceite de convite respondem 401/400 de credencial errada: não é sessão vencida.
const ANONYMOUS = ['/api/auth/login', '/api/auth/invites/accept'];

export function createApi(env: AppEnv): Api {
  let unauthorized: () => void = () => undefined;
  const client = createClient<paths>({
    baseUrl: env.baseUrl,
    credentials: 'same-origin',
    fetch: (request) => env.fetch(request),
  });
  client.use({
    onResponse({ request, response }) {
      const path = new URL(request.url).pathname;
      if (response.status === 401 && !ANONYMOUS.some((p) => path.endsWith(p))) unauthorized();
    },
  });
  return {
    client,
    onUnauthorized(handler) {
      unauthorized = handler;
    },
  };
}

/** Desembrulha o `{ data, error, response }` do `openapi-fetch`: erro vira `ApiFailure`. */
export async function ok<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) throw new ApiFailure(response.status, isProblem(error) ? error : undefined);
  return data as T;
}

/** Texto para a pessoa a partir de qualquer erro (problem, rede, exceção). */
export function messageOf(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 403) return error.problem?.detail ?? 'Sem permissão para esta ação.';
    if (error.status === 429) return 'Muitas tentativas. Espere um pouco e tente de novo.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
