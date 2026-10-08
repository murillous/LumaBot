# @zapforge/storage-sqlite — documentação

Adapter de storage padrão do ZapForge, sobre o SQLite que vem no próprio Node (`node:sqlite`). Ele
implementa o `StoragePort` do core ([Storage](../../core/docs/storage.md)) e passa na suíte de
contrato. O porquê do driver e do schema está no
[ADR 0051](../../../docs/adr/0051-sqlite-via-node-sqlite.md).

## Uso

```ts
import { createBot } from '@zapforge/core';
import { sqlite } from '@zapforge/storage-sqlite';
import { baileys } from '@zapforge/transport-baileys';

const bot = createBot({
  transport: baileys(),
  storage: sqlite({ path: 'data/bot.sqlite' }), // dados dos plugins e credenciais do WhatsApp
  plugins: [],
});
await bot.start();
```

O bot fecha o storage no `stop()`.

## Opções

| Opção | Efeito |
| --- | --- |
| `path` | Arquivo do banco. Se o arquivo não existir, o adapter cria o arquivo e as pastas do caminho. Com `':memory:'`, o banco fica só na memória e é descartado no `close()`, o que serve para testes |

`sqlite()` abre o banco na hora e lança uma exceção se o arquivo não abrir ou se tiver sido
gravado por uma versão mais nova do adapter (veja [Migrations](#migrations)).

## No disco

O banco abre em modo WAL, com `synchronous = NORMAL`. Uma queda do processo não perde dados.
Uma queda do sistema operacional pode perder só a última transação. Ao lado do arquivo ficam o
`-wal` e o `-shm`, que fazem parte do banco: para copiar ou fazer backup, pare o bot e copie os
três arquivos, ou use `VACUUM INTO` com o bot rodando.

Outro processo pode ler o banco enquanto o bot roda. Se ele segurar uma escrita, o adapter espera
até 5 s antes de falhar (`busy_timeout`). Para vários processos escrevendo, use o Postgres.

## Schema

O schema pertence ao adapter, e nenhum plugin cria tabela (ADR 0015).

| Tabela | Conteúdo |
| --- | --- |
| `kv` | `(namespace, key) → value` em JSON |
| `documents` | Documentos de todas as coleções: `namespace`, `collection`, `id` e `doc` em JSON. O `seq` é a ordem de inserção |
| `auth_creds` | Credenciais de cada sessão do transport |
| `auth_keys` | Chaves do auth state: `(session, type, id) → value` |

Os filtros viram condições sobre `json_extract(doc, '$.campo')` e conferem o `json_type`, para
que `1`, `'1'` e `true` continuem diferentes. Um campo declarado em `indexes` ganha um índice de
expressão por `(namespace, collection, json_extract(doc, '$.campo'))`, criado na primeira operação
da coleção. Esse índice vale para o campo em todas as coleções.

## Migrations

A versão do schema fica no `PRAGMA user_version`. A cada abertura, o adapter aplica as migrations
que faltam, cada uma numa transação. Um banco gravado por uma versão mais nova do adapter é
recusado no boot, para não corromper o que ela gravou.

Para mudar o schema, acrescente uma migration no fim de `MIGRATIONS` em `src/schema.ts`. Nunca
edite uma migration que já foi publicada.

## Testes

`src/sqlite.contract.test.ts` roda a suíte de contrato do core em memória e em arquivo. Em
arquivo, a suíte também fecha e reabre o banco para verificar a persistência.
`src/sqlite.test.ts` cobre o que é do adapter: WAL, migrations, índices e o tamanho do lote
do auth state.
