// Aceite do #120 (ADR 0076): um servidor HTTP por processo, dividido pelos bots. Só abre a porta
// se houver rota; `/health` responde pelo estado das sessões; rotas de plugin sob
// `/plugins/<nome>`, de transport sob `/transports/<nome>`, e as de outra sessão sob
// `/sessions/<sessão>`; WebSocket para os dois.

import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BotConfigError } from '#config/owners.ts';
import type { PluginErrorEvent } from '#events/types.ts';
import { createHttp } from '#http/server.ts';
import type { HttpRoutes, HttpServer } from '#http/types.ts';
import { definePlugin } from '#plugin/define.ts';
import type { PluginDefinition } from '#plugin/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { type Bot, type BotConfig, createBot } from './bot.ts';
import { deferred, RecordingTransport, recordingLogger } from './harness.test-support.ts';

const ENGINE = '>=0.0.0';
const bots: Bot[] = [];

afterEach(async () => {
  for (const created of bots.splice(0)) await created.stop().catch(() => undefined);
});

function bot(config: Partial<BotConfig>): Bot {
  const created = createBot({
    transport: new RecordingTransport(),
    logger: recordingLogger(),
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    env: {},
    ...config,
  });
  bots.push(created);
  return created;
}

function server(): HttpServer {
  return createHttp({ port: 0, hostname: '127.0.0.1' });
}

function url(http: HttpServer, path: string, scheme = 'http'): string {
  if (http.port === undefined) throw new Error('servidor fechado');
  return `${scheme}://127.0.0.1:${http.port}${path}`;
}

/** Plugin com `GET /users/:id`, `POST /falha` (lança) e o WebSocket `/eco`. */
const api = definePlugin({
  name: 'api',
  version: '1.0.0',
  engine: ENGINE,
  config: z.object({ versao: z.number().default(1) }),
  setup(ctx) {
    ctx.http.route('GET', '/users/:id', (_req, { params }) =>
      Response.json({ id: params['id'], versao: ctx.config.versao, base: ctx.http.basePath }),
    );
    ctx.http.route('POST', '/falha', () => {
      throw new Error('quebrou');
    });
    ctx.http.ws('/eco', (req) => {
      if (new URL(req.url).searchParams.get('token') !== 'ok') {
        return new Response('sem token', { status: 401 });
      }
      return {
        onMessage(socket, data) {
          socket.send(`eco:${String(data)}`);
        },
      };
    });
  },
});

/** Plugin que só registra rota com `rota: true`, para a porta abrir depois do boot. */
const tardio = definePlugin({
  name: 'tardio',
  version: '1.0.0',
  engine: ENGINE,
  config: z.object({ rota: z.boolean().default(false) }),
  setup(ctx) {
    if (ctx.config.rota) ctx.http.route('GET', '/', () => new Response('tardio'));
  },
});

const semRota = definePlugin({
  name: 'sem-rota',
  version: '1.0.0',
  engine: ENGINE,
  setup: () => undefined,
});

interface OpenSocket {
  readonly socket: WebSocket;
  readonly messages: string[];
  readonly closed: Promise<CloseEvent>;
}

function connectSocket(address: string): Promise<OpenSocket> {
  const socket = new WebSocket(address);
  const messages: string[] = [];
  const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener('close', resolve));
  socket.addEventListener('message', (event) => messages.push(String(event.data)));
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ socket, messages, closed }));
    socket.addEventListener('error', () => reject(new Error(`WebSocket recusado: ${address}`)));
  });
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe('HTTP do core (ADR 0076)', () => {
  it('sem rota registrada a porta não abre', async () => {
    const http = server();
    await bot({ http, plugins: [semRota] }).start();
    expect(http.port).toBeUndefined();
  });

  it('rota de plugin sob /plugins/<nome>, com params, e /health 200', async () => {
    const http = server();
    await bot({ http, plugins: [api] }).start();

    const user = await fetch(url(http, '/plugins/api/users/7'));
    expect(user.status).toBe(200);
    expect(await user.json()).toEqual({ id: '7', versao: 1, base: '/plugins/api' });
    // Barra final ignorada.
    expect((await fetch(url(http, '/plugins/api/users/7/'))).status).toBe(200);
    expect((await fetch(url(http, '/plugins/outro/users/7'))).status).toBe(404);

    const health = await fetch(url(http, '/health'));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', sessions: { default: 'running' } });
  });

  it('/health responde 503 enquanto uma sessão não está running', async () => {
    const http = server();
    await bot({ http, plugins: [api] }).start();
    const hold = deferred();
    const slow = new RecordingTransport();
    const connect = slow.connect.bind(slow);
    let connecting = false;
    slow.connect = async () => {
      connecting = true;
      await hold.promise;
      await connect();
    };
    const starting = bot({ http, session: 'erp', storage: createMemoryStorage(), transport: slow });
    const started = starting.start();
    // Preso no connect: a sessão já está no servidor, ainda `starting`.
    await until(() => connecting);

    const degraded = await fetch(url(http, '/health'));
    expect(degraded.status).toBe(503);
    expect(await degraded.json()).toEqual({
      status: 'degraded',
      sessions: { default: 'running', erp: 'starting' },
    });

    hold.resolve();
    await started;
    expect((await fetch(url(http, '/health'))).status).toBe(200);
  });

  it('outra sessão fica sob /sessions/<sessão>; a default, sem prefixo', async () => {
    const http = server();
    const storage = createMemoryStorage();
    await bot({ http, storage, plugins: [api] }).start();
    await bot({ http, storage, session: 'erp', plugins: [api] }).start();

    const local = await fetch(url(http, '/plugins/api/users/1'));
    expect(await local.json()).toMatchObject({ base: '/plugins/api' });
    const erp = await fetch(url(http, '/sessions/erp/plugins/api/users/1'));
    expect(await erp.json()).toMatchObject({ base: '/sessions/erp/plugins/api' });
  });

  it('a mesma sessão em dois bots no mesmo servidor recusa o segundo', async () => {
    const http = server();
    await bot({ http, plugins: [api] }).start();
    const transport = new RecordingTransport();
    const second = bot({ http, storage: createMemoryStorage(), transport });

    await expect(second.start()).rejects.toThrow(BotConfigError);
    expect(transport.calls).toEqual([]);
    // O primeiro segue servindo.
    expect((await fetch(url(http, '/plugins/api/users/1'))).status).toBe(200);
  });

  it('o transport registra rotas na fábrica, sob /transports/<nome>', async () => {
    const http = server();
    let routes: HttpRoutes | undefined;
    let early: unknown;
    const created = bot({
      http,
      transport: (deps) => {
        routes = deps.http;
        try {
          void deps.http?.basePath;
        } catch (error) {
          early = error;
        }
        deps.http?.route('POST', '/webhook', async (req) =>
          Response.json({ recebido: await req.json() }),
        );
        return new RecordingTransport();
      },
    });
    await created.start();

    // Antes de a fábrica devolver o transport, o nome dele ainda não existe.
    expect(early).toBeInstanceOf(Error);
    expect(routes?.basePath).toBe('/transports/test');
    const response = await fetch(url(http, '/transports/test/webhook'), {
      method: 'POST',
      body: JSON.stringify({ update: 1 }),
    });
    expect(await response.json()).toEqual({ recebido: { update: 1 } });
  });

  it('sem `http` no bot, o transport não recebe rotas', async () => {
    let routes: HttpRoutes | undefined = {} as HttpRoutes;
    await bot({
      transport: (deps) => {
        routes = deps.http;
        return new RecordingTransport();
      },
    }).start();
    expect(routes).toBeUndefined();
  });

  it('handler que lança vira 500 e plugin.error com phase http', async () => {
    const http = server();
    const errors: PluginErrorEvent[] = [];
    const observer = definePlugin({
      name: 'observer',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('plugin.error', (c) => {
          errors.push(c.payload);
        });
      },
    });
    await bot({ http, plugins: [api, observer] }).start();

    const response = await fetch(url(http, '/plugins/api/falha'), { method: 'POST' });
    expect(response.status).toBe(500);
    await until(() => errors.length === 1);
    expect(errors[0]).toMatchObject({ plugin: 'api', phase: 'http', event: 'POST /falha' });
  });

  it('ctx.http sem servidor derruba o setup do plugin', async () => {
    const created = bot({ plugins: [api] });
    await created.start();

    const [entry] = created.plugins();
    expect(entry).toMatchObject({ name: 'api', status: 'skipped' });
    expect(entry?.status === 'skipped' && entry.reason.kind).toBe('setup-failed');
  });

  it('WebSocket: eco, recusa com Response e fecha com 1001 no reload', async () => {
    const http = server();
    const created = bot({ http, plugins: [api] });
    await created.start();

    await expect(connectSocket(url(http, '/plugins/api/eco', 'ws'))).rejects.toThrow();
    const open = await connectSocket(url(http, '/plugins/api/eco?token=ok', 'ws'));
    open.socket.send('oi');
    await until(() => open.messages.length === 1);
    expect(open.messages).toEqual(['eco:oi']);

    await created.config.setOverrides('api', { versao: 2 });
    expect((await open.closed).code).toBe(1001);
    // As rotas do setup novo valem.
    const user = await fetch(url(http, '/plugins/api/users/1'));
    expect(await user.json()).toMatchObject({ versao: 2 });
  });

  it('rota registrada depois do boot abre a porta', async () => {
    const http = server();
    const created = bot({ http, plugins: [tardio] });
    await created.start();
    expect(http.port).toBeUndefined();

    await created.config.setOverrides('tardio', { rota: true });
    await until(() => http.port !== undefined);
    expect(await (await fetch(url(http, '/plugins/tardio'))).text()).toBe('tardio');
  });

  it('o último bot a parar fecha a porta', async () => {
    const http = server();
    const storage = createMemoryStorage();
    const first = bot({ http, storage, plugins: [api] });
    const second = bot({ http, storage, session: 'erp', plugins: [api] });
    await first.start();
    await second.start();

    await first.stop();
    expect(http.port).toBeDefined();
    // As rotas da sessão que parou saem; as da outra seguem.
    expect((await fetch(url(http, '/plugins/api/users/1'))).status).toBe(404);
    expect((await fetch(url(http, '/sessions/erp/plugins/api/users/1'))).status).toBe(200);
    expect(await (await fetch(url(http, '/health'))).json()).toEqual({
      status: 'ok',
      sessions: { erp: 'running' },
    });

    await second.stop();
    expect(http.port).toBeUndefined();
  });

  it('porta ocupada derruba o boot antes do connect', async () => {
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
    const address = busy.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const transport = new RecordingTransport();
      const plugins: PluginDefinition[] = [api];
      const created = bot({
        http: createHttp({ port, hostname: '127.0.0.1' }),
        transport,
        plugins,
      });

      await expect(created.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(transport.calls).toEqual([]);
      expect(created.state).toBe('stopped');
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  });

  it('createHttp recusa porta inválida e o bot recusa servidor que não veio dele', () => {
    expect(() => createHttp({ port: 70_000 })).toThrow(RangeError);
    expect(() => bot({ http: { port: 3000 } })).toThrow(BotConfigError);
  });
});
