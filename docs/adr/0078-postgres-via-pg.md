# ADR 0078 — Postgres pelo `pg`, com schema próprio, documentos em `jsonb` e migrations do adapter

**Status:** Aceito (2026-10-10) · Detalha **D14** ([ADR 0014](0014-storage-port-sqlite-postgres.md))
e **D15** ([ADR 0015](0015-storage-kv-e-colecoes.md)), no molde do SQLite
([ADR 0051](0051-sqlite-via-node-sqlite.md)) · Implementa a trava do **D74**
([ADR 0074](0074-trava-de-sessao-entre-processos.md))

## Contexto

O `@zapforge/storage-postgres` é o adapter oficial para vários processos dividindo o banco (D14),
e o segundo adapter real: é ele que mostra se o `StoragePort` vazou o SQLite (#119). Ele precisa
de um driver, de um lugar para as tabelas dentro de um banco que pode ser de outros sistemas, e
de um jeito de evoluir o schema com vários processos subindo ao mesmo tempo.

Para o driver, havia duas alternativas:

- **`pg` (node-postgres)**: o driver mais usado, em JavaScript puro (o binding nativo é opcional
  e fica de fora), com pool, tipos e parse de `jsonb` prontos.
- **`postgres` (porsager)**: API de template string, mais rápido em alguns benchmarks. Menos
  difundido, e o ganho não aparece no volume de um bot.

## Decisão

- O adapter usa o **`pg`**, com um `Pool`. A fábrica é assíncrona (`await postgres({...})`):
  conecta e migra no boot, e um banco fora do ar ou um schema mais novo rejeitam ali, não na
  primeira mensagem.
- As tabelas ficam num **schema Postgres próprio**, `zapforge` por padrão (opção `schema`). O
  nome é validado (`[a-z_][a-z0-9_]*`), porque vai interpolado no SQL.
- O schema é o **mesmo desenho do SQLite**: `kv`, `documents`, `auth_creds`, `auth_keys` e
  `leases`, com namespace, coleção e chave em colunas separadas e `seq` como ordem de inserção.
  O documento é **`jsonb`**, para filtrar, ordenar e indexar no banco; KV e auth state guardam o
  JSON em **texto**, que volta byte a byte e aceita `\u0000` (o `jsonb` recusa).
- Os filtros comparam o campo como `jsonb` com o ausente virando `null`
  (`COALESCE(doc->'campo', 'null'::jsonb)`): a igualdade do `jsonb` já separa `1`, `"1"` e
  `true`, e nunca dá NULL. Texto compara com `COLLATE "C"` (code point). O `update` é o `||` do
  `jsonb`, que já é o merge raso do contrato.
- Um índice declarado vira um índice de expressão por `(namespace, collection, campo)`, com nome
  por hash do campo (identificador do Postgres tem 63 caracteres).
- As **migrations são do adapter**: lista só de acréscimos, versão numa tabela
  `schema_version` do schema. O boot inteiro roda numa transação, sob um advisory lock por
  schema: processos que sobem juntos migram uma vez, e um schema mais novo que o adapter é
  recusado.
- A trava mede a validade pelo **relógio do servidor** (`clock_timestamp()`), porque os
  processos podem estar em máquinas diferentes.
- Os testes rodam contra um **Postgres de verdade**: um container de serviço no job de testes do
  CI e, localmente, a URL em `ZAPFORGE_TEST_POSTGRES_URL`. Sem a URL, os testes do banco são
  pulados fora do CI e falham no CI. Cada teste usa um schema novo, apagado no fim.

## Consequências

- A mesma suíte de contrato passa no SQLite e no Postgres sem nenhuma mudança no core: o port
  não vazou o SQLite (D14).
- Uma dependência de runtime (`pg`), sem addon nativo.
- Um banco Postgres pode guardar o ZapForge ao lado de outros sistemas, e bots com dados
  separados no mesmo banco usam schemas diferentes.
- O `jsonb` recusa `\u0000` em texto e reordena as chaves do documento. A ordem das chaves não é
  contrato; o `\u0000` em campo de documento faz a escrita rejeitar.
- Quem roda os testes localmente precisa de um Postgres (um `docker run` basta, veja a doc do
  pacote); sem ele, só os testes do banco ficam de fora.
- Mudar o schema exige uma migration nova no fim da lista; uma já publicada nunca é editada.
