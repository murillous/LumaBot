import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, createApi, messageOf, ok } from './api.ts';
import type { AppEnv } from './env.ts';

const reply = (status: number) => async () =>
  new Response(JSON.stringify({ title: 'Erro', status, detail: 'nada' }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

const apiWith = (answer: () => Promise<Response>) => {
  const seen: Request[] = [];
  const env: AppEnv = {
    baseUrl: 'http://bot.test',
    fetch: ((request: Request) => {
      seen.push(request);
      return answer();
    }) as typeof fetch,
    openEvents: () => {
      throw new Error('fora do escopo');
    },
  };
  return { api: createApi(env), seen };
};

describe('createApi', () => {
  it('um 401 numa chamada autenticada avisa que a sessão acabou', async () => {
    const { api } = apiWith(reply(401));
    const onUnauthorized = vi.fn();
    api.onUnauthorized(onUnauthorized);
    await api.client.GET('/api/connection');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('o 401 do login e do convite é credencial errada, não sessão vencida', async () => {
    const { api } = apiWith(reply(401));
    const onUnauthorized = vi.fn();
    api.onUnauthorized(onUnauthorized);
    await api.client.POST('/api/auth/login', { body: { email: 'a@b.c', password: 'x' } });
    await api.client.POST('/api/auth/invites/accept', { body: { token: 't', password: 'x' } });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('manda o cookie da mesma origem', async () => {
    const { api, seen } = apiWith(reply(500));
    await api.client.GET('/api/health');
    expect(seen[0]?.credentials).toBe('same-origin');
  });
});

describe('ok e messageOf', () => {
  it('erro da API vira ApiFailure com a mensagem do problem', async () => {
    const { api } = apiWith(reply(400));
    const failure = await ok(api.client.GET('/api/health')).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(messageOf(failure)).toBe('nada');
  });

  it('403 e 429 ganham texto próprio', () => {
    expect(messageOf(new ApiFailure(403, undefined))).toBe('Sem permissão para esta ação.');
    expect(messageOf(new ApiFailure(429, undefined))).toContain('Muitas tentativas');
  });
});
