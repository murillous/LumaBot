# HTTP e WebSocket

O core tem **um** servidor HTTP por processo, dividido por todos os bots, para webhooks, o
dashboard e o chat web ([ADR 0020](../../../docs/adr/0020-http-unico-hono.md),
[ADR 0076](../../../docs/adr/0076-http-do-core.md)). Plugins registram rotas em `ctx.http`, o
transport em `deps.http`. A porta só abre se houver rota.

## Ligar o servidor

```ts
import { createBot, createHttp } from '@zapforge/core';

const http = createHttp({ port: 3000 });
const storage = sqlite({ path: 'data/bot.db' });

const zap = createBot({ transport: baileys(), storage, http, plugins });
const erp = createBot({ session: 'erp', transport: web(), storage, http, plugins });
await Promise.all([zap.start(), erp.start()]);
```

| Opção de `createHttp` | Padrão | O que faz |
| --- | --- | --- |
| `port` | — | Porta; `0` escolhe uma livre (leia em `http.port`) |
| `hostname` | todas as interfaces | Interface de escuta (`'127.0.0.1'` atrás de proxy reverso) |

- Passe a **mesma** instância a todos os bots, como o storage. Dois bots com a mesma `session` no
  mesmo servidor: o segundo `start()` rejeita com `BotConfigError`.
- `createHttp` não abre nada. A porta abre no `start()`, depois do `setup` dos plugins e antes do
  `connect()` do transport, se algum bot tiver rota. Sem rota, nenhuma porta. Uma rota que chega
  depois (reload de plugin) abre a porta na hora.
- Porta ocupada (`EADDRINUSE`) derruba o boot antes do `connect()`, como um plugin quebrado.
- `http.port` é a porta em escuta, ou `undefined` com o servidor fechado.
- A porta fecha quando o **último** bot para. As conexões abertas (requisição em curso,
  keep-alive, WebSocket) caem junto.
- Sem `http` no `createBot`, `ctx.http.route` lança `BotConfigError`: o plugin cai no `setup`
  (status `skipped`, motivo `setup-failed`) e os outros seguem. O transport recebe `deps.http`
  ausente.

## Caminhos

| Rota | Sessão `default` | Outra sessão (`erp`) |
| --- | --- | --- |
| saúde | `/health` | `/health` |
| plugin `dashboard` | `/plugins/dashboard/...` | `/sessions/erp/plugins/dashboard/...` |
| transport `web` | `/transports/web/...` | `/sessions/erp/transports/web/...` |

A sessão `default` não tem prefixo: a URL de um webhook já cadastrado na plataforma não muda
quando entra um segundo bot. `ctx.http.basePath` e `deps.http.basePath` dão o prefixo de cada um,
para montar uma URL pública.

## `/health`

`GET /health` responde pelo estado de todos os bots ligados ao servidor:

```json
200 { "status": "ok", "sessions": { "default": "running", "erp": "running" } }
503 { "status": "degraded", "sessions": { "default": "running", "erp": "starting" } }
```

200 só com todas as sessões em `running`. Serve de liveness e readiness para Docker e PM2. O
corpo mostra os nomes das sessões: se isso não pode ser público, não exponha o `/health` no
proxy.

## Rotas no plugin

```ts
setup(ctx) {
  ctx.http.route('POST', '/webhook', async (req) => {
    const body = await req.json();
    await ctx.send.send(body.chatId, body.text);
    return Response.json({ ok: true });
  });
  ctx.http.route('GET', '/users/:id', (_req, { params }) => Response.json({ id: params['id'] }));
}
```

- O handler recebe o `Request` da Web API e `{ params }`, e devolve um `Response` (ou a promise
  dele). Sem tipo do Hono no contrato: o Hono é detalhe interno.
- Métodos: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`; o `HEAD` sai do `GET`.
- `path` começa com `/` e aceita `:param` e `*`. Barra final é ignorada (`/x` e `/x/` são a
  mesma rota). `'/'` é a própria base (`/plugins/<nome>`).
- O mesmo método e caminho duas vezes no mesmo plugin lança `HttpRouteConflictError`. Plugins
  diferentes nunca colidem: cada um tem a própria base.
- Handler que lança, rejeita ou devolve algo que não é `Response` responde 500. O erro vai para o
  log do bot e para `plugin.error` com `phase: 'http'` e `event` igual à rota (`'POST /webhook'`).
- O handler não tem prazo do kernel nem roda na fila de um chat: o cliente HTTP decide quanto
  espera. Também não tem tenant corrente: use `ctx.storage.forTenant(id)` com o tenant que vier
  da requisição ([Storage](storage.md)).
- **Autenticação é do plugin.** O core não confere nada: valide token, assinatura do webhook ou
  JWT no handler.
- As rotas vivem com o contexto: o `teardown` e o reload as tiram, e o `setup` novo as registra
  de novo. Registrar depois do `teardown` lança, como os outros registros do `ctx`.

## WebSocket

```ts
ctx.http.ws('/live', (req) => {
  if (!valid(new URL(req.url).searchParams.get('token'))) {
    return new Response('sem token', { status: 401 }); // recusa o upgrade
  }
  return {
    onOpen(socket) { sockets.add(socket); },
    onMessage(socket, data) { socket.send(`eco: ${data}`); },
    onClose(socket, code, reason) { sockets.delete(socket); },
  };
});
```

- O segundo argumento decide o upgrade com os headers do pedido: devolve os callbacks da
  conexão, ou um `Response` para recusar. `GET` comum (sem `Upgrade: websocket`) recebe 426.
- `ws` ocupa o `GET` do caminho: `route('GET', p)` e `ws(p)` juntos dão `HttpRouteConflictError`.
- `data` chega como `string` (texto) ou `ArrayBuffer` (binário). `socket.send` aceita `string`,
  `ArrayBuffer` e `Uint8Array` (Buffer incluso).
- Erro num callback (síncrono ou rejeição) vai para o log e para `plugin.error`, e a conexão
  segue aberta. Feche você com `socket.close(code, reason)` se for o caso.
- Quando a rota sai (teardown, reload, stop), as conexões dela fecham com código **1001**. O
  cliente reconecta e cai no `setup` novo.

## Rotas no transport

Transports com webhook (Telegram, Discord, WhatsApp oficial) ou chat próprio (web) registram as
rotas pela fábrica ([Transport → Adapter com fábrica](transport.md#adapter-com-fábrica)):

```ts
export function telegram(options: TelegramOptions): (deps: TransportDeps) => Transport {
  return ({ log, http }) => {
    const transport = new TelegramTransport(options, log);
    http?.route('POST', '/webhook', (req) => transport.handleUpdate(req));
    // `basePath` só existe depois que a fábrica devolve o transport: leia no `connect()`.
    transport.onConnect(() => transport.setWebhook(`${options.publicUrl}${http?.basePath}/webhook`));
    return transport;
  };
}
```

- `deps.http` só existe com `http` no `createBot`. Sem ele, o transport precisa de outro caminho
  (long polling) ou falha no `connect()` com erro claro.
- Registre **na fábrica**: a porta abre antes do `connect()`, então o webhook já responde quando
  a plataforma for avisada. Registro sem I/O não fere a regra da fábrica.
- A base é `/transports/<name>` (o `Transport.name`, codificado para URL). As rotas do transport
  vivem até o bot parar.
- Erro de handler do transport vai para o log do bot (não há `plugin.error`: não é plugin).

## Encerramento

No `stop()`, o `teardown` dos plugins tira as rotas deles. Depois do `disconnect()` do transport,
o bot tira as rotas do transport e sai do servidor; o último bot a sair fecha a porta, antes do
`storage.close()` ([Bot → Shutdown](bot.md#shutdown-gracioso-stop)).
