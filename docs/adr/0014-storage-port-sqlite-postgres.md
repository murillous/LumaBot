# ADR 0014 — `StoragePort` com SQLite e Postgres na v1; auth state no port

**Status:** Aceito (2026-10-06) · Decisão **D14** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

No LumaBot, o `StoragePort` só é usado em testes; o código real chama
`DatabaseService` estático. A autenticação usa `useMultiFileAuthState`, que o
próprio Baileys não recomenda para produção. Com um único adapter, o port tenderia
a vazar o formato do SQLite.

Alternativas consideradas: só SQLite; só Postgres; armazenamento em memória.

## Decisão

O core define o `StoragePort`. A v1 entrega dois adapters oficiais:
`@zapforge/storage-sqlite` (padrão) e `@zapforge/storage-postgres`. O auth state do
WhatsApp é guardado no mesmo port.

## Consequências

- SQLite = "clona e roda"; Postgres = escala comercial multi-processo.
- Ter dois adapters garante que o port não vaza o SQLite.
- Mais superfície para testar: o mesmo conjunto de testes de contrato roda nos dois.
