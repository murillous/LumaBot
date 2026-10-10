# ADR 0076 — HTTP do core: um servidor por processo, rotas de plugin e de transport por sessão

**Status:** Aceito (2026-10-09) · Detalha **D20** ([ADR 0020](0020-http-unico-hono.md)), **D37**
([ADR 0037](0037-transport-por-fabrica.md)) e o item de HTTP do **D75**
([ADR 0075](0075-varios-bots-e-escopo-compartilhado.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O D20 decidiu um servidor HTTP no core (Hono), que só sobe se houver rota, com `/health` e as
rotas de plugin em `/plugins/<name>/...`. Nada disso existia (#120). Desde então mudaram três
coisas:

- **O transport também precisa de rota.** O `transport-web` (#287, D55) recebe o chat por HTTP e
  WebSocket; os webhooks do Telegram, do Discord e do WhatsApp oficial também chegam por HTTP. O
  D20 só previa rota de plugin.
- **Vários bots no mesmo processo** (D75): um transport por `Bot`, uma sessão cada, a mesma
  instância de storage. O D75 já apontou um servidor por processo, "passado aos bots como o
  storage", e deixou a forma e os caminhos para este ADR.
- **Contrato neutro antes do 1.0** (D55, D69): o que entra no contrato público fica congelado no
  1.0. Expor o `Context` do Hono prenderia a major do core à do Hono.

A investigação:

- O router do Hono não remove rota. As rotas mudam no boot, no reload de um plugin e no stop:
  remontar o app a partir de uma tabela a cada mudança é barato e mantém o roteamento do Hono
  (params, `*`, barra final).
- O `@hono/node-server` 2 já faz o upgrade de WebSocket (sobre o `ws`), com os headers do pedido
  disponíveis antes do handshake. Não precisa do `@hono/node-ws`.
- O transport registra rota na fábrica (D37), que roda no `createBot`, antes de existir o
  `Transport.name`. A base do caminho só pode ser resolvida depois.
- O `createBot` não tem efeito colateral (ADR 0004). Registrar rota num servidor dividido seria
  um, então a tabela de cada bot só entra no servidor no `start()`.

Alternativas consideradas:

- **Opções por bot** (`BotConfig.http: { port }`): cada bot com a sua porta. Dois bots na mesma
  porta dão `EADDRINUSE`, contra o "um servidor por processo" do D75.
- **Servidor padrão implícito** (sem `http`, o bot cria um na 3000): mais curto com um bot, mas
  dois bots sem config colidem na porta, e uma porta abre sem o app pedir.
- **Todo caminho com a sessão** (`/sessions/default/plugins/...`): uniforme, mas some o caminho
  do D20.
- **Sem prefixo enquanto houver um bot só**: a URL dos webhooks já cadastrados mudaria quando
  entrasse o segundo bot.
- **Handler com o `Context` do Hono** (amostra do §6.8 do plano): helpers e validadores prontos,
  mas o contrato público passa a depender da API do Hono.
- **`/health` sempre 200 e mínimo**: não expõe nome de sessão, mas não serve de readiness.
- **Hub de processo** (`createHub({ bots, http, storage })`): descartado no D75, e continua
  desnecessário: a instância compartilhada já faz o papel.

## Decisão

- **`createHttp({ port, hostname? })`** em `@zapforge/core` devolve o servidor do processo, que o
  app passa em **`BotConfig.http`**, a mesma instância para todos os bots, como o storage. Sem
  `http`, `ctx.http.route`/`ws` lançam `BotConfigError` (o plugin cai no `setup`) e o transport
  recebe `deps.http` ausente.
- **A porta só abre se houver rota.** O bot liga a sessão ao servidor no `start()` (sessão
  repetida no mesmo servidor é `BotConfigError`) e abre a porta depois do `setup` dos plugins e
  antes do `connect()`, para o webhook do transport já responder. Porta ocupada derruba o boot.
  Rota que chega depois (reload) abre a porta na hora. O último bot a parar fecha a porta, antes
  do `storage.close()`, cortando as conexões abertas.
- **Caminhos:** `/health`; `/plugins/<nome>/...` e `/transports/<name>/...` na sessão `default`;
  `/sessions/<sessão>/plugins/...` e `/sessions/<sessão>/transports/...` nas outras. A URL de um
  bot não muda quando entra outro. `basePath` dá o prefixo de cada um.
- **Contrato com a Web API:** `route(method, path, (request, { params }) => Response)` e
  `ws(path, (request, { params }) => handlers | Response)`. Métodos `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE`, `OPTIONS`. O `Response` no `ws` recusa o upgrade (ex.: 401). Os callbacks da conexão
  são `onOpen`, `onMessage` e `onClose`, e o socket tem `send` e `close`. O Hono é detalhe interno.
- **Plugin: `ctx.http`**, sob `/plugins/<nome>`. As rotas vivem com o contexto: o `dispose`
  (teardown, reload) as tira e fecha os WebSockets delas com 1001. Registro depois do `dispose`
  lança, como os outros registros. Erro de handler responde 500 e vai para `plugin.error` com a
  fase nova **`http`** e a rota em `event`.
- **Transport: `TransportDeps.http`**, opcional e aditivo (D37), sob `/transports/<name>`.
  Registrado na fábrica, com a base resolvida depois que ela devolve o transport. Vive até o bot
  parar. Erro de handler vai para o log do bot.
- **`/health`**: 200 com todas as sessões ligadas em `running`, 503 senão; o corpo traz
  `{ status, sessions: { <sessão>: <estado> } }`.
- **Sem autenticação, prazo ou tenant no kernel.** O handler confere o próprio token ou
  assinatura, não roda na fila de um chat e escolhe o tenant com `forTenant` (D72).

## Consequências

- Mudança aditiva: `createHttp`, `HttpRouteConflictError`, os tipos `Http*`, `BotConfig.http`,
  `ctx.http` e `TransportDeps.http` são novos. `PluginErrorEvent.phase` ganha `http`, que é minor
  pelo D69 (quem faz `switch` já tem `default`).
- `hono`, `@hono/node-server` e `ws` viram dependências do core. Quem não passa `http` não abre
  porta nem carrega servidor nenhum.
- O `/health` mostra os nomes das sessões. Se isso não pode ser público, o app não o expõe no
  proxy.
- A tabela de rotas é remontada a cada mudança (boot, reload, stop), não por requisição.
- O dashboard (D21) e o `transport-web` (#287) têm onde se pendurar. O dashboard central de
  vários números continua fora (D21).
- Aceite em `bot/http.test.ts`; os casos de borda do servidor, em `http/server.test.ts`.
