import { afterEach, describe, expect, it } from 'vitest';
import { createNoopLogger } from '#logger/logger.ts';
import { createHttp, HttpRouteConflictError, type SessionHttp, sessionHttp } from './server.ts';
import type { HttpMethod, HttpServer } from './types.ts';

const attached: SessionHttp[] = [];

afterEach(async () => {
  for (const session of attached.splice(0)) await session.detach();
});

function setup(errors: unknown[] = []): {
  http: HttpServer;
  session: SessionHttp;
  routes: ReturnType<SessionHttp['scope']>;
} {
  const http = createHttp({ port: 0, hostname: '127.0.0.1' });
  const session = sessionHttp(http, 'default', createNoopLogger);
  const routes = session.scope(
    'api',
    () => '/plugins/api',
    (error) => errors.push(error),
  );
  return { http, session, routes };
}

async function up(session: SessionHttp): Promise<void> {
  session.attach(() => 'running');
  attached.push(session);
  await session.listen();
}

const base = (http: HttpServer, scheme = 'http'): string =>
  `${scheme}://127.0.0.1:${http.port}/plugins/api`;

describe('SessionHttp', () => {
  it('recusa a mesma rota duas vezes do mesmo dono, caminho sem barra e método fora da lista', () => {
    const { routes } = setup();
    routes.route('GET', '/x', () => new Response());
    expect(() => routes.route('GET', '/x/', () => new Response())).toThrow(HttpRouteConflictError);
    // WebSocket ocupa o GET do caminho.
    expect(() => routes.ws('/x', () => ({}))).toThrow(HttpRouteConflictError);
    expect(() => routes.route('POST', '/x', () => new Response())).not.toThrow();
    expect(() => routes.route('GET', 'x', () => new Response())).toThrow(TypeError);
    expect(() => routes.route('TRACE' as HttpMethod, '/y', () => new Response())).toThrow(
      TypeError,
    );
  });

  it('handler que não devolve Response vira 500 com o erro no onError', async () => {
    const errors: unknown[] = [];
    const { http, session, routes } = setup(errors);
    routes.route('GET', '/nada', () => 'texto' as unknown as Response);
    await up(session);

    expect((await fetch(`${base(http)}/nada`)).status).toBe(500);
    expect(errors).toEqual([expect.any(TypeError)]);
  });

  it('GET comum num caminho de WebSocket responde 426', async () => {
    const { http, session, routes } = setup();
    routes.ws('/ws', () => ({}));
    await up(session);

    expect((await fetch(`${base(http)}/ws`)).status).toBe(426);
  });

  it('erro num callback do WebSocket vai ao onError sem fechar a conexão', async () => {
    const errors: unknown[] = [];
    const { http, session, routes } = setup(errors);
    routes.ws('/ws', () => ({
      async onMessage(socket, data) {
        if (data === 'quebra') throw new Error('callback');
        socket.send(`ok:${String(data)}`);
      },
    }));
    await up(session);

    const socket = new WebSocket(`${base(http, 'ws')}/ws`);
    const received: string[] = [];
    socket.addEventListener('message', (event) => received.push(String(event.data)));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    socket.send('quebra');
    socket.send('segue');
    for (let i = 0; i < 200 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(received).toEqual(['ok:segue']);
    expect(errors).toEqual([expect.objectContaining({ message: 'callback' })]);
    socket.close();
  });

  it('detach fecha as conexões abertas e, sendo a última sessão, a porta', async () => {
    const { http, session, routes } = setup();
    routes.ws('/ws', () => ({}));
    await up(session);
    const socket = new WebSocket(`${base(http, 'ws')}/ws`);
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener('close', resolve));
    await new Promise((resolve) => socket.addEventListener('open', resolve));

    await session.detach();

    expect((await closed).code).toBe(1001);
    expect(http.port).toBeUndefined();
  });

  it('volta a abrir a porta para um bot novo depois de fechar', async () => {
    const { http, session, routes } = setup();
    routes.route('GET', '/', () => new Response('um'));
    await up(session);
    await session.detach();
    expect(http.port).toBeUndefined();

    const next = sessionHttp(http, 'default', createNoopLogger);
    next
      .scope(
        'api',
        () => '/plugins/api',
        () => undefined,
      )
      .route('GET', '/', () => new Response('dois'));
    await up(next);

    expect(await (await fetch(base(http))).text()).toBe('dois');
  });
});
