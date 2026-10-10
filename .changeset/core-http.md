---
'@zapforge/core': minor
---

HTTP do core (ADR 0076): `createHttp({ port })` passado em `BotConfig.http`, o mesmo servidor
para todos os bots do processo. A porta só abre se houver rota e fecha quando o último bot para.
Plugins registram rotas e WebSocket em `ctx.http` (sob `/plugins/<nome>`) e transports em
`TransportDeps.http` (sob `/transports/<name>`), com `Request`/`Response` da Web API; outra
sessão que não a `default` fica sob `/sessions/<sessão>`. `/health` responde 200 com todas as
sessões em `running` e 503 senão. Erro de rota de plugin sai em `plugin.error` com
`phase: 'http'`.
