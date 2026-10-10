// Contrato do HTTP do core (ADR 0020, 0076): Request/Response da Web API, sem tipo do Hono, que
// fica como detalhe interno do servidor.

/** Métodos aceitos numa rota. `HEAD` sai do `GET`. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface HttpRequestInfo {
  /** Parâmetros do caminho (`/users/:id` → `{ id }`). */
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Responde a uma requisição. Erro (ou retorno que não é `Response`) vira 500 e vai para o log
 * do bot; no plugin, também para `plugin.error` com `phase: 'http'`.
 */
export type HttpHandler = (request: Request, info: HttpRequestInfo) => Response | Promise<Response>;

/** Uma conexão WebSocket aberta. */
export interface HttpSocket {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

/** Callbacks de uma conexão. Erro (síncrono ou rejeição) vai para o log e não fecha a conexão. */
export interface HttpSocketHandlers {
  onOpen?(socket: HttpSocket): void | Promise<void>;
  /** Texto chega como `string`; binário, como `ArrayBuffer`. */
  onMessage?(socket: HttpSocket, data: string | ArrayBuffer): void | Promise<void>;
  onClose?(socket: HttpSocket, code: number, reason: string): void | Promise<void>;
}

/**
 * Decide o pedido de upgrade: devolve os callbacks da conexão, ou um `Response` para recusar
 * (ex.: 401 sem token). Roda antes do handshake, com os headers do pedido.
 */
export type HttpSocketAccept = (
  request: Request,
  info: HttpRequestInfo,
) => HttpSocketHandlers | Response | Promise<HttpSocketHandlers | Response>;

/**
 * Rotas de um plugin (`ctx.http`) ou do transport (`TransportDeps.http`), todas sob `basePath`.
 * Vivem até o plugin descer (teardown, reload) ou o bot parar; as conexões WebSocket abertas
 * fecham junto, com código 1001.
 */
export interface HttpRoutes {
  /**
   * Caminho público das rotas: `/plugins/<nome>` ou `/transports/<nome>`, sob
   * `/sessions/<sessão>` fora da sessão `default`. Serve para montar a URL de um webhook.
   */
  readonly basePath: string;
  /**
   * Registra `method` em `basePath + path`. `path` começa com `/` e aceita `:param` e `*`; barra
   * final é ignorada. Mesmo método e caminho duas vezes lança `HttpRouteConflictError`.
   */
  route(method: HttpMethod, path: string, handler: HttpHandler): void;
  /** WebSocket em `basePath + path`; ocupa o `GET` desse caminho. */
  ws(path: string, accept: HttpSocketAccept): void;
}

export interface HttpOptions {
  /** Porta. `0` escolhe uma livre (leia em `HttpServer.port`). */
  readonly port: number;
  /** Interface de escuta. Padrão: todas. */
  readonly hostname?: string;
}

/**
 * Servidor HTTP do processo (`createHttp`), passado aos bots em `BotConfig.http` (o mesmo para
 * todos, como o storage). Só abre a porta se algum bot tiver rota, e fecha quando o último para.
 */
export interface HttpServer {
  /** Porta em escuta; `undefined` com o servidor fechado. */
  readonly port: number | undefined;
}
