# @zapforge/storage-postgres — documentação

Adapter de storage do ZapForge para vários processos (ou máquinas) dividindo o mesmo banco. Ele
implementa o `StoragePort` do core ([Storage](../../core/docs/storage.md)) e passa na mesma suíte
de contrato do [`@zapforge/storage-sqlite`](../../storage-sqlite/docs/README.md). O porquê do
driver e do schema está no [ADR 0078](../../../docs/adr/0078-postgres-via-pg.md).

## Uso

```ts
import { createBot } from '@zapforge/core';
import { postgres } from '@zapforge/storage-postgres';
import { baileys } from '@zapforge/transport-baileys';

const bot = createBot({
  transport: baileys(),
  storage: await postgres({ connectionString: 'postgres://bot:senha@db:5432/bot' }),
  plugins: [],
});
await bot.start();
```

O bot fecha o storage no `stop()`, o que encerra as conexões.

## Opções

| Opção | Efeito |
| --- | --- |
| `connectionString` | URL do banco (`postgres://usuario:senha@host:5432/banco`), com os parâmetros que o [`pg`](https://node-postgres.com/features/connecting) aceita (`?sslmode=require`, por exemplo) |
| `schema` | Schema do Postgres onde ficam as tabelas. Padrão: `zapforge`. Criado se não existir; aceita `[a-z_][a-z0-9_]*`, até 63 caracteres |

`postgres()` é assíncrona: conecta, cria o schema e aplica as migrations. Ela rejeita se o banco
não responde, se o usuário não pode criar o schema ou se o schema foi gravado por uma versão mais
nova do adapter (veja [Migrations](#migrations)). Nesses casos, as conexões abertas são fechadas.

## Vários processos

Processos que apontam para o mesmo banco e o mesmo `schema` dividem os dados: KV, coleções,
auth state e a trava de sessão. A trava impede a mesma sessão de rodar em dois processos
([Bot](../../core/docs/bot.md)); a validade dela é medida pelo relógio do servidor Postgres, então
o relógio das máquinas dos bots não precisa estar sincronizado.

Para dados separados no mesmo banco (dois clientes, por exemplo), use um `schema` diferente em
cada um.

Cada processo abre até 10 conexões (o padrão do pool do `pg`). Uma conexão ociosa que cai
(banco reiniciado, rede) é descartada e vira um aviso no processo (`process.emitWarning`); a
próxima operação abre outra.

## Schema

O schema pertence ao adapter, e nenhum plugin cria tabela (ADR 0015). O desenho é o mesmo do
SQLite:

| Tabela | Conteúdo |
| --- | --- |
| `kv` | `(namespace, key) → value`, o JSON em texto |
| `documents` | Documentos de todas as coleções: `namespace`, `collection`, `id` e `doc` em `jsonb`. O `seq` é a ordem de inserção |
| `auth_creds` | Credenciais de cada sessão do transport, o JSON em texto |
| `auth_keys` | Chaves do auth state: `(session, type, id) → value`, o JSON em texto |
| `leases` | Trava de cada sessão entre processos: `name → (owner, expires_at)` ([ADR 0074](../../../docs/adr/0074-trava-de-sessao-entre-processos.md)) |
| `schema_version` | Versão do schema (uma linha) |

Os filtros comparam `COALESCE(doc->'campo', 'null'::jsonb)`: a igualdade do `jsonb` mantém `1`,
`'1'` e `true` diferentes, e o campo ausente vale `null`. Texto compara e ordena com
`COLLATE "C"`, por code point. Um campo declarado em `indexes` ganha um índice de expressão por
`(namespace, collection, campo)`, criado na primeira operação da coleção e válido para o campo em
todas as coleções.

O `jsonb` não guarda o caractere `\u0000` em texto: um documento com ele num campo é recusado pelo
banco. KV e auth state guardam o JSON como texto e aceitam.

## Migrations

A cada boot, o adapter aplica numa transação só as migrations que faltam, com um advisory lock
por schema: se vários processos sobem juntos, um migra e os outros esperam. Um schema gravado por
uma versão mais nova do adapter é recusado, para não corromper o que ela gravou.

Para mudar o schema, acrescente uma migration no fim de `MIGRATIONS` em `src/schema.ts`. Nunca
edite uma migration que já foi publicada.

## Testes

Os testes do banco precisam de um Postgres, indicado em `ZAPFORGE_TEST_POSTGRES_URL`:

```sh
docker run -d --name zapforge-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17-alpine
ZAPFORGE_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm test
```

Sem a variável, esses testes são pulados. No CI eles são obrigatórios: o job de testes sobe um
Postgres em container ([`ci.yml`](../../../.github/workflows/ci.yml)), e a variável ausente faz a
suíte falhar. Cada teste cria um schema novo e o apaga no fim, então o banco pode ser reaproveitado.

`src/postgres.contract.test.ts` roda a suíte de contrato do core, inclusive a persistência
(fechar e reabrir o pool sobre o mesmo schema). `src/postgres.test.ts` cobre o que é do adapter:
migrations, boot concorrente, índices, lote grande do auth state e a trava disputada por dois
pools.
