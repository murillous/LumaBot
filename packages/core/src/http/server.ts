// Servidor HTTP do processo (ADR 0020, 0076). Um por processo, dividido pelos bots como o
// storage: cada bot publica a própria tabela de rotas (`SessionHttp`) ao subir e a retira ao
// parar. O router do Hono não remove rota, então o app é remontado da tabela a cada mudança,
// que só acontece no boot, no reload e no stop. Hono, adapter do Node e `ws` carregam só ao
// abrir a porta: bot sem rota não paga a memória deles.

import type { Server } from 'node:http';
import type { upgradeWebSocket as UpgradeWebSocket } from '@hono/node-server';
import type { Context, Hono } from 'hono';
import type { WSContext, WSEvents } from 'hono/ws';
import type { WebSocketServer } from 'ws';
import { BotConfigError } from '#config/owners.ts';
import type { Logger } from '#logger/types.ts';
import { DEFAULT_SESSION } from '#storage/namespace.ts';
import type {
  HttpHandler,
  HttpMethod,
  HttpOptions,
  HttpRequestInfo,
  HttpRoutes,
  HttpServer,
  HttpSocket,
  HttpSocketAccept,
  HttpSocketHandlers,
} from './types.ts';

const METHODS: ReadonlySet<string> = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

/** Código de fechamento "going away": a rota sumiu (reload, teardown ou stop). */
const GOING_AWAY = 1001;

/** O mesmo método e caminho registrados duas vezes pelo mesmo dono. */
export class HttpRouteConflictError extends Error {
  override readonly name = 'HttpRouteConflictError';
  readonly method: HttpMethod;
  readonly path: string;

  constructor(method: HttpMethod, path: string) {
    super(`rota ${method} ${path} já registrada`);
    this.method = method;
    this.path = path;
  }
}

/** Módulos do servidor, carregados na primeira abertura da porta. */
interface ServerLib {
  readonly Hono: typeof Hono;
  readonly upgradeWebSocket: typeof UpgradeWebSocket;
}

interface RouteEntry {
  readonly owner: string;
  readonly method: HttpMethod;
  /** Caminho relativo, normalizado (sem barra final). */
  readonly path: string;
  /** Resolvido ao montar o app: o nome do transport só existe depois da fábrica. */
  readonly base: () => string;
  readonly target: HttpHandler | { readonly ws: HttpSocketAccept };
  readonly onError: (error: unknown) => void;
  /** Conexões abertas, fechadas quando a rota sai. */
  readonly sockets: Set<WSContext>;
}

// O `HttpServer` público só expõe a porta; o resto é do kernel.
const hubs = new WeakMap<HttpServer, HttpHub>();

/**
 * Servidor HTTP para `BotConfig.http`, o mesmo para todos os bots do processo. Nada abre aqui:
 * a porta abre no `start()` do primeiro bot que tiver rota (ver docs/http.md).
 */
export function createHttp(options: HttpOptions): HttpServer {
  const { port } = options;
  if (!(Number.isInteger(port) && port >= 0 && port <= 65_535)) {
    throw new RangeError(`http: port deve ser inteiro entre 0 e 65535 (recebido: ${port})`);
  }
  const hub = new HttpHub(options);
  const server: HttpServer = {
    get port() {
      return hub.port;
    },
  };
  hubs.set(server, hub);
  return server;
}

/** Tabela de rotas de uma sessão nesse servidor; sem efeito até o `attach`. */
export function sessionHttp(server: HttpServer, session: string, log: () => Logger): SessionHttp {
  const hub = hubs.get(server);
  if (hub === undefined) {
    throw new BotConfigError('http: passe o servidor criado por `createHttp({ port })`');
  }
  return new SessionHttp(hub, session, log);
}

/** Prefixo das rotas da sessão: nenhum na `default`, para a URL não mudar quando entra outro bot. */
function sessionPrefix(session: string): string {
  return session === DEFAULT_SESSION ? '' : `/sessions/${session}`;
}

function normalizePath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(`http: o caminho deve começar com "/" (recebido: ${String(path)})`);
  }
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Rotas de um bot no servidor. Publicadas no `attach` (start) e retiradas no `detach` (stop). */
export class SessionHttp {
  readonly session: string;
  readonly log: () => Logger;
  readonly #hub: HttpHub;
  readonly #prefix: string;
  readonly #entries = new Map<string, RouteEntry>();
  #state: () => string = () => 'idle';
  #attached = false;

  constructor(hub: HttpHub, session: string, log: () => Logger) {
    this.#hub = hub;
    this.session = session;
    this.log = log;
    this.#prefix = sessionPrefix(session);
  }

  /**
   * Rotas de um dono (um plugin, ou o transport) sob `prefixo + segment()`. `onError` recebe a
   * falha de um handler com a rota (`POST /webhook`).
   */
  scope(
    owner: string,
    segment: () => string,
    onError: (error: unknown, route: string) => void,
  ): HttpRoutes {
    const base = (): string => this.#prefix + segment();
    const add = (method: HttpMethod, rawPath: string, target: RouteEntry['target']): void => {
      const path = normalizePath(rawPath);
      const key = `${owner} ${method} ${path}`;
      if (this.#entries.has(key)) throw new HttpRouteConflictError(method, path);
      this.#entries.set(key, {
        owner,
        method,
        path,
        base,
        target,
        onError: (error) => onError(error, `${method} ${path}`),
        sockets: new Set(),
      });
      if (this.#attached) this.#hub.changed();
    };
    return {
      get basePath() {
        return base();
      },
      route(method, path, handler) {
        if (!METHODS.has(method)) {
          throw new TypeError(`http: método não suportado: ${String(method)}`);
        }
        add(method, path, handler);
      },
      ws(path, accept) {
        add('GET', path, { ws: accept });
      },
    };
  }

  entries(): Iterable<RouteEntry> {
    return this.#entries.values();
  }

  get hasRoutes(): boolean {
    return this.#entries.size > 0;
  }

  state(): string {
    return this.#state();
  }

  /** Tira as rotas de um dono (teardown ou reload do plugin) e fecha as conexões delas. */
  removeOwner(owner: string): void {
    let removed = false;
    for (const [key, entry] of this.#entries) {
      if (entry.owner !== owner) continue;
      this.#entries.delete(key);
      closeSockets(entry);
      removed = true;
    }
    if (removed && this.#attached) this.#hub.changed();
  }

  /** Publica as rotas no servidor; sessão repetida no mesmo servidor é erro de config. */
  attach(state: () => string): void {
    this.#hub.attach(this);
    this.#state = state;
    this.#attached = true;
  }

  /** Abre a porta se alguma sessão tiver rota (e, daqui em diante, quando a primeira chegar). */
  listen(): Promise<void> {
    return this.#hub.listen();
  }

  /** Retira as rotas; o último bot a sair fecha a porta. */
  async detach(): Promise<void> {
    if (!this.#attached) return;
    this.#attached = false;
    for (const entry of this.#entries.values()) closeSockets(entry);
    this.#entries.clear();
    await this.#hub.detach(this);
  }
}

class HttpHub {
  readonly #options: HttpOptions;
  readonly #sessions = new Map<string, SessionHttp>();
  #app: Hono | undefined;
  #lib: ServerLib | undefined;
  #server: Server | undefined;
  #wss: WebSocketServer | undefined;
  #listening: Promise<void> | undefined;
  #closing: Promise<void> = Promise.resolve();
  // Algum bot terminou o boot: rota que chegar depois (reload) abre a porta na hora.
  #armed = false;

  constructor(options: HttpOptions) {
    this.#options = options;
  }

  get port(): number | undefined {
    const address = this.#server?.address();
    return address !== null && typeof address === 'object' ? address.port : undefined;
  }

  attach(session: SessionHttp): void {
    if (this.#sessions.has(session.session)) {
      throw new BotConfigError(
        `http: a sessão "${session.session}" já está ligada a este servidor; cada bot precisa ` +
          'de um `session` diferente',
      );
    }
    this.#sessions.set(session.session, session);
    this.changed();
  }

  async detach(session: SessionHttp): Promise<void> {
    if (this.#sessions.get(session.session) !== session) return;
    this.#sessions.delete(session.session);
    this.changed();
    if (this.#sessions.size === 0) await this.#close();
  }

  changed(): void {
    this.#app = undefined;
    if (this.#armed && this.#listening === undefined && this.#hasRoutes()) {
      this.#listen().catch((error: unknown) =>
        this.#log()?.error('http: falha ao abrir a porta', {
          err: error,
          port: this.#options.port,
        }),
      );
    }
  }

  listen(): Promise<void> {
    this.#armed = true;
    return this.#hasRoutes() ? this.#listen() : Promise.resolve();
  }

  #hasRoutes(): boolean {
    for (const session of this.#sessions.values()) if (session.hasRoutes) return true;
    return false;
  }

  #log(): Logger | undefined {
    for (const session of this.#sessions.values()) return session.log();
    return undefined;
  }

  #listen(): Promise<void> {
    if (this.#listening === undefined) {
      // Um fechamento em curso libera a porta antes de abrir de novo.
      const opening = this.#closing.then(() => this.#open());
      this.#listening = opening;
      // Falhou (porta ocupada): a próxima chamada tenta de novo. O erro segue para quem esperou.
      opening.catch(() => {
        if (this.#listening === opening) this.#listening = undefined;
      });
    }
    return this.#listening;
  }

  async #open(): Promise<void> {
    const [{ createAdaptorServer, upgradeWebSocket }, { Hono }, { WebSocketServer }] =
      await Promise.all([import('@hono/node-server'), import('hono'), import('ws')]);
    this.#lib = { Hono, upgradeWebSocket };
    const wss = new WebSocketServer({ noServer: true });
    const server = createAdaptorServer({
      fetch: (request, env) => this.#currentApp().fetch(request, env),
      websocket: { server: wss },
    }) as Server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#options.port, this.#options.hostname, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => this.#log()?.error('http: erro no servidor', { err: error }));
    this.#server = server;
    this.#wss = wss;
  }

  async #close(): Promise<void> {
    this.#armed = false;
    const listening = this.#listening;
    if (listening === undefined) return;
    this.#listening = undefined;
    // Abertura que falhou não deixou nada para fechar.
    const closing = listening.then(
      () => this.#shut(),
      () => undefined,
    );
    this.#closing = closing.catch(() => undefined);
    await closing;
  }

  #shut(): Promise<void> {
    const server = this.#server;
    const wss = this.#wss;
    this.#server = undefined;
    this.#wss = undefined;
    if (server === undefined) return Promise.resolve();
    for (const client of wss?.clients ?? []) client.terminate();
    return new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // Os bots já pararam: requisição em curso (ou keep-alive) não segura o encerramento.
      server.closeAllConnections();
    });
  }

  #currentApp(): Hono {
    // Só há requisição com a porta aberta, e a abertura carregou a lib.
    const lib = this.#lib as ServerLib;
    this.#app ??= this.#build(lib);
    return this.#app;
  }

  #build(lib: ServerLib): Hono {
    const app = new lib.Hono({ strict: false });
    app.get('/health', (c) => {
      const sessions: Record<string, string> = {};
      for (const [name, session] of this.#sessions) sessions[name] = session.state();
      const ok = Object.values(sessions).every((state) => state === 'running');
      return c.json({ status: ok ? 'ok' : 'degraded', sessions }, ok ? 200 : 503);
    });
    for (const session of this.#sessions.values()) {
      for (const entry of session.entries()) mount(app, entry, lib.upgradeWebSocket);
    }
    app.onError((error, c) => {
      this.#log()?.error('http: erro fora de um handler', { err: error });
      return c.text('Internal Server Error', 500);
    });
    return app;
  }
}

function mount(app: Hono, entry: RouteEntry, upgradeWebSocket: typeof UpgradeWebSocket): void {
  const base = entry.base();
  const path = entry.path === '/' ? base : base + entry.path;
  const info = (c: Context): HttpRequestInfo => ({ params: c.req.param() });
  const { target } = entry;
  if (typeof target === 'function') {
    app.on(entry.method, path, async (c) => {
      try {
        const response = await target(c.req.raw, info(c));
        if (response instanceof Response) return response;
        throw new TypeError(`o handler de ${entry.method} ${entry.path} não devolveu um Response`);
      } catch (error) {
        entry.onError(error);
        return c.text('Internal Server Error', 500);
      }
    });
    return;
  }
  app.get(path, async (c, next) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return c.text('Upgrade Required', 426);
    }
    let decided: HttpSocketHandlers | Response;
    try {
      decided = await target.ws(c.req.raw, info(c));
    } catch (error) {
      entry.onError(error);
      return c.text('Internal Server Error', 500);
    }
    if (decided instanceof Response) return decided;
    const handlers = decided;
    const upgrade = upgradeWebSocket(() => socketEvents(entry, handlers), {
      onError: (error) => entry.onError(error),
    });
    return (await upgrade(c, next)) ?? c.text('Internal Server Error', 500);
  });
}

/** Callbacks do Hono ligados aos do autor, com cada conexão registrada na rota. */
function socketEvents(entry: RouteEntry, handlers: HttpSocketHandlers): WSEvents {
  let socket: HttpSocket | undefined;
  const wrap = (ws: WSContext): HttpSocket => {
    socket ??= {
      // O `ws` do Node aceita qualquer `Uint8Array` (Buffer incluso); o tipo do Hono pede o de
      // `ArrayBuffer` só.
      send: (data) => ws.send(data as string | ArrayBuffer),
      close: (code, reason) => ws.close(code, reason),
    };
    return socket;
  };
  const run = (callback: () => void | Promise<void>): void => {
    try {
      Promise.resolve(callback()).catch(entry.onError);
    } catch (error) {
      entry.onError(error);
    }
  };
  return {
    onOpen(_event, ws) {
      entry.sockets.add(ws);
      run(() => handlers.onOpen?.(wrap(ws)));
    },
    onMessage(event, ws) {
      run(() => handlers.onMessage?.(wrap(ws), event.data as string | ArrayBuffer));
    },
    onClose(event, ws) {
      entry.sockets.delete(ws);
      run(() => handlers.onClose?.(wrap(ws), event.code, event.reason));
    },
  };
}

function closeSockets(entry: RouteEntry): void {
  for (const ws of entry.sockets) ws.close(GOING_AWAY, 'rota removida');
  entry.sockets.clear();
}
