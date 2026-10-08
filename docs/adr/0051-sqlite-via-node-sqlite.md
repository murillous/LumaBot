# ADR 0051 — SQLite pelo `node:sqlite`, com schema único e migrations do adapter

**Status:** Aceito (2026-10-07) · Detalha **D14** ([ADR 0014](0014-storage-port-sqlite-postgres.md))
e **D15** ([ADR 0015](0015-storage-kv-e-colecoes.md))

## Contexto

O `@zapforge/storage-sqlite` é o adapter padrão, o do "clona e roda" (D14). Ele precisa de um
driver SQLite e de um jeito de criar e evoluir as tabelas.

Para o driver, havia duas alternativas:

- **`better-sqlite3`**: o driver que o legacy usa, maduro e rápido. Mas é um addon nativo. O
  `pnpm install` precisa baixar um binário pronto para a plataforma ou compilar com
  toolchain C++, e o workspace hoje nega os scripts de build de dependência (`allowBuilds`). Cada
  versão nova do Node exige um binário novo.
- **`node:sqlite`**: vem no próprio Node. No Node 24, que é o mínimo do monorepo, roda sem flag e
  sem aviso. A versão do SQLite embutida tem JSON1 e WAL. Os dois drivers são síncronos.

Para o schema, os plugins não criam tabela, porque a API não expõe SQL (D15). O formato do banco
pertence só ao adapter.

## Decisão

- O adapter usa o **`node:sqlite`** (`DatabaseSync`) e não tem dependência de runtime além do
  `@zapforge/core`.
- O schema é **fixo e genérico**: uma tabela para o KV, uma para os documentos de todas as
  coleções (com o documento em JSON numa coluna `doc`) e duas para o auth state. Namespace,
  coleção e chave ficam em colunas separadas. Um índice declarado vira um índice de expressão
  sobre `json_extract(doc, '$.campo')`, criado na primeira operação da coleção.
- As **migrations são do adapter**: uma lista só de acréscimos, cuja versão fica no
  `PRAGMA user_version`. O boot aplica as pendentes, cada uma numa transação. Se o banco foi
  gravado por uma versão mais nova do adapter, o boot falha.
- O banco abre com `journal_mode = WAL`, `synchronous = NORMAL` e `busy_timeout = 5000`.

## Consequências

- O `pnpm install` não compila nada e não depende da plataforma. Atualizar o Node não quebra o
  storage.
- O driver é síncrono. Cada operação bloqueia o event loop enquanto roda, assim como no
  `better-sqlite3`. Para o volume de um bot isso é microssegundos. Carga multi-processo fica
  com o Postgres (D14).
- O `node:sqlite` ainda está marcado como em desenvolvimento ativo no Node. Se a API mudar, o
  ajuste fica restrito a este pacote, e a suíte de contrato detecta a regressão.
- Um índice serve ao campo em todas as coleções, porque é por `(namespace, collection, valor)`.
  Isso custa um pouco de escrita nas coleções que não o declararam, em troca de não ter DDL por
  coleção.
- Mudar o schema exige uma migration nova no fim da lista. Uma migration já publicada nunca
  é editada.
