# ADR 0020 — Servidor HTTP único no core (Hono)

**Status:** Aceito (2026-10-06) · Decisão **D20** do [plano](../../ZAPFORGE_PLAN.md#4-decisões) · Forma, caminhos por sessão e rotas de transport: [ADR 0076](0076-http-do-core.md)

## Contexto

Os transports comerciais (Cloud API, Twilio, Zenvia) recebem webhooks, e o
dashboard precisa de HTTP/WS. Um servidor por plugin multiplica portas e
configuração.

Alternativas consideradas: servidor por plugin; nenhum HTTP no core.

## Decisão

O core tem **um** servidor HTTP (Hono sobre `node:http`), que só sobe se alguém
registrar rota. Expõe `/health`; as rotas de plugin ficam em `/plugins/<name>/...`.

## Consequências

- Webhooks e dashboard numa porta só.
- Bots que não precisam de HTTP não abrem porta nenhuma.
- Hono vira dependência do core.
