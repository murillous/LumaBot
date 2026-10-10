# Storage

O `StoragePort` é o armazenamento do bot: **KV** e **coleções** por plugin, e o **auth state**
do transport. A API não expõe SQL nem nada de engine
([ADR 0014](../../../docs/adr/0014-storage-port-sqlite-postgres.md),
[ADR 0015](../../../docs/adr/0015-storage-kv-e-colecoes.md)): o mesmo plugin roda em memória,
SQLite ou Postgres. A semântica abaixo é fixada pela [suíte de contrato](#suíte-de-contrato),
que todo adapter roda.

## Para autores de plugin

O plugin recebe `ctx.storage` já isolado no namespace do nome dele: não vê nem altera dados de
outro plugin nem do kernel.

```ts
// Use `type`, não `interface`: o documento precisa ter assinatura de índice JSON.
type Reminder = { chatId: string; fireAt: number; text: string; note?: string };

setup(ctx) {
  await ctx.storage.kv.set('lastRun', Date.now());
  const lastRun = await ctx.storage.kv.get<number>('lastRun'); // number | undefined

  const reminders = ctx.storage.collection<Reminder>('reminders', { indexes: ['fireAt'] });
  const id = await reminders.insert({ chatId, fireAt, text });
  const due = await reminders.find({
    where: { fireAt: { lte: Date.now() } },
    orderBy: 'fireAt',
    limit: 50,
  });
  await reminders.update(id, { text: 'novo texto' });
  await reminders.delete({ chatId });
}
```

### KV

| Método | Retorno |
| --- | --- |
| `get<T>(key)` | Cópia do valor, ou `undefined` se a chave não existe |
| `set(key, value)` | Grava (substitui) |
| `delete(key)` | `true` se a chave existia |

Chaves são strings quaisquer. Valores são `JsonValue`.

### Valores são JSON, e sempre cópias

Tudo o que é gravado passa pela semântica de `JSON.stringify`: campos `undefined` somem,
`NaN`/`Infinity` viram `null`, `Date` vira texto. O que sai de `get`/`find` é uma cópia nova:
mutar o objeto devolvido (ou o que você gravou) não altera o storage. `Buffer` não é JSON:
converta antes (base64, por exemplo).

### Coleções

`collection<T>(name, { indexes })` devolve a coleção `name` do namespace; pedir de novo o mesmo
nome enxerga os mesmos dados. `indexes` é só dica de desempenho (o adapter cria índice para
esses campos) e nunca muda resultados.

| Método | O que faz |
| --- | --- |
| `insert(doc)` | Grava e devolve o `id` gerado (texto opaco, único na coleção) |
| `get(id)` | Documento com `id`, ou `undefined` |
| `find(query?)` | Documentos com `id` (`WithId<T>[]`) |
| `update(alvo, patch)` | Merge **raso** nos documentos do alvo; devolve quantos casaram |
| `delete(alvo)` | Remove os documentos do alvo; devolve quantos removeu |

O **alvo** é um `id` (string) ou um filtro (`where`). `delete({})` esvazia a coleção.

O campo `id` é reservado: quem gera é o adapter. `insert`/`update` com `id` no documento
rejeitam com `TypeError`. O patch substitui só os campos de primeiro nível presentes (um campo
objeto é trocado inteiro); `update(alvo, {})` conta os que casaram sem alterar nada. Atualizar
um documento não muda a posição dele na ordem de inserção.

### Filtros (`where`)

Campos de primeiro nível (ou `id`), combinados com **E**. Valor escalar é `eq` implícito;
objeto é um conjunto de operadores, também combinados com E:

```ts
{ where: { chatId: 'x', fireAt: { gte: start, lt: end }, status: { in: ['new', 'retry'] } } }
```

| Operador | Operando | Casa quando |
| --- | --- | --- |
| `eq` (ou valor direto) | escalar | mesmo tipo **e** mesmo valor |
| `ne` | escalar | o contrário exato de `eq` |
| `in` | array de escalares | `eq` a algum item (`[]` não casa com nada) |
| `gt` `gte` `lt` `lte` | número ou texto | o campo tem o **mesmo tipo** do operando e a comparação vale |

Regras que valem em todo adapter:

- **Campo ausente vale `null`.** `{ x: null }` casa com `x: null` e com documento sem `x`;
  `{ x: { ne: 5 } }` inclui documentos sem `x`.
- **Sem coerção de tipo.** `1`, `'1'` e `true` são diferentes. `gt`/`lt` nunca casam com
  `null`, ausente ou outro tipo (`{ n: { gt: 0 } }` ignora `n: 'abc'`).
- **Texto compara por code point** (a ordem dos bytes UTF-8), não pela ordem UTF-16 do `<` do
  JavaScript nem por collation de idioma.
- Arrays e objetos não são comparáveis: `eq` nunca casa com eles, `ne` sempre.
- Sem OU, sem campos aninhados (`'a.b'`) e sem busca textual. Se fizer falta, a lacuna é do
  core (ADR 0015).

### Ordenação e paginação

```ts
{ orderBy: 'fireAt' }
{ orderBy: { field: 'score', direction: 'desc' } }
{ orderBy: ['chatId', { field: 'score', direction: 'desc' }], limit: 10, offset: 20 }
```

- Critérios em ordem de precedência; `direction` padrão `'asc'`.
- Entre tipos, a ordem crescente é `null`/ausente < booleano (`false` < `true`) < número <
  texto < array/objeto (estes empatam entre si). `desc` inverte.
- **Empates seguem a ordem de inserção**, também em `desc`; sem `orderBy`, a ordem é a de
  inserção. Paginar com `limit`/`offset` é, portanto, estável.
- `limit` e `offset` são inteiros >= 0, aplicados depois do filtro e da ordenação.

### Erros

| Situação | Erro |
| --- | --- |
| Operador desconhecido, objeto de operadores vazio, operando de tipo errado, `NaN` | `TypeError` |
| Campo de filtro/ordenação/índice fora de `[A-Za-z_][A-Za-z0-9_]*` | `TypeError` |
| Documento que não é objeto, ou com `id` | `TypeError` |
| `limit`/`offset` negativo ou fracionário | `RangeError` |
| Qualquer operação depois de `close()` | `StorageClosedError` |

Os métodos são `async`: o erro chega como rejeição. A exceção é `collection()` com índice
inválido, que lança na hora.

### Tenants

Quando um bot atende vários clientes do dono (escolas, empresas), o transport marca o
`chat.tenantId` ([ADR 0072](../../../docs/adr/0072-isolamento-por-tenant.md)). O plugin não
filtra nada: numa mensagem ou num evento desse chat, o mesmo `ctx.storage` grava e lê no
namespace daquele tenant. Isso vale também para o que o handler dispara:

- a closure do `setup` que usa `ctx.storage`, e a coleção obtida no `setup`;
- o service de outro plugin chamado pelo handler, que grava no storage dele, no mesmo tenant;
- o timer ou a promise iniciados no handler;
- o job agendado no handler, que guarda o tenant e roda nele ([scheduler](scheduler.md)).

Fora disso (`setup`, timer iniciado no `setup`, job agendado sem tenant), vale o escopo da
sessão, o mesmo dos transports sem tenant. Ele é **compartilhado entre os tenants**: serve para o
que é do plugin inteiro, não de um cliente.

`forTenant(id)` escolhe um tenant à mão, de qualquer lugar, inclusive do handler de outro tenant.
Serve para o `setup`, para um job sem tenant ou para um plugin de administração. Quem pode usar
esse comando é decidido pelo `role`:

```ts
ctx.commands.add({
  name: 'resumo',
  role: 'owner',
  async run(c) {
    const escola = c.args[0] ?? '';
    const alunos = await ctx.storage.forTenant(escola).collection('alunos').find();
    await c.reply(`${alunos.length} alunos`);
  },
});
```

`forTenant('')` lança `TypeError`. Trocar o ID de tenant "esquece" os dados do anterior, como
trocar o nome da sessão.

### Dados comuns a vários bots

Com vários bots no mesmo storage (um por transport: WhatsApp, Telegram, web), o `ctx.storage` de
cada um fica na sua sessão. Para o que deve ser um só em todos eles (um rank, as personas, a
memória de uma assistente), o plugin pede `ctx.storage.shared`
([ADR 0075](../../../docs/adr/0075-varios-bots-e-escopo-compartilhado.md)). Ele tem o mesmo `kv`
e as mesmas `collection` e só o próprio plugin o alcança, em qualquer sessão.

IDs de contato e de chat só são únicos dentro de um transport: o `42` do Telegram não é o `42` do
Discord. Quando a chave vem de um ID, componha com `ctx.transportName`:

```ts
const key = `${ctx.transportName}:${c.message.sender.id}`;
const pontos = ((await ctx.storage.shared.kv.get<number>(key)) ?? 0) + 1;
await ctx.storage.shared.kv.set(key, pontos);
```

- O `shared` segue o tenant como o `ctx.storage`: no chat de um tenant, grava no `shared` daquele
  tenant, e `ctx.storage.shared.forTenant(id)` escolhe um à mão.
- Não há transação. Ler, somar e gravar a mesma chave em dois bots ao mesmo tempo pode perder um
  dos incrementos, como já acontece em dois chats do mesmo bot. Quando isso importa, guarde um
  documento por pessoa numa coleção em vez de um contador comum.
- O que não deve ser comum continua no `ctx.storage`, sem mudança.

## Para o kernel

Tudo nesta seção é interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)).

`pluginStorage(port, pluginName)` é como o `Bot` monta `ctx.storage` (o port é o `storage` do
`createBot`, fechado no `stop()`). Namespaces que
começam com `$` são do kernel: `pluginStorage` lança `ReservedNamespaceError` para eles, então
nenhum plugin alcança os dados internos, seja qual for o nome dele. Componentes do kernel usam
`kernelStorage(port, 'scheduler')` (namespace `$scheduler`), `kernelStorage(port, 'config')`
etc. `isReservedNamespace(name)` serve para validar nomes cedo (manifesto, M1-8).

### Escopo de sessão

O `Bot` não passa o `storage` direto para scheduler, config e plugins: passa
`sessionStorage(port, session)` ([ADR 0036](../../../docs/adr/0036-escopo-de-sessao.md)), uma
visão que prefixa todo namespace com a sessão. O `StoragePort` e os adapters não mudam.

| Sessão | Plugin `sticker` | Scheduler | Overrides de config |
| --- | --- | --- | --- |
| `'default'` | `sticker` | `$scheduler` | `$config` |
| `'vendas'` | `vendas:sticker` | `vendas:$scheduler` | `vendas:$config` |

O nome da sessão é kebab-case (sem `:`), e `pluginStorage` também recusa `:` no nome do plugin
(`ReservedNamespaceError`): nenhum plugin forja o namespace de outra sessão, nem na `'default'`,
que fica sem prefixo para manter o formato de quem não passa `session`. `authState(session)` e
`close()` passam direto: o auth state já é separado por sessão.

### Escopo compartilhado

`sharedStorage(port)` é a visão do storage comum às sessões
([ADR 0075](../../../docs/adr/0075-varios-bots-e-escopo-compartilhado.md)): monta sobre o
`storage` do `createBot`, não sobre o da sessão, e prefixa todo namespace com `$shared:`. O
`ctx.storage.shared` é o `tenantStorage(sharedStorage(port), plugin, scope)`.

| Sessão | `ctx.storage` | `ctx.storage.shared` | No tenant `escola-a` |
| --- | --- | --- | --- |
| `'default'` | `rank` | `$shared:rank` | `$shared:rank@escola-a` |
| `'vendas'` | `vendas:rank` | `$shared:rank` | `$shared:rank@escola-a` |

Começa com `$`, então nenhum namespace de plugin de sessão alguma coincide com ele, e os
componentes do kernel não têm `:` no nome.

### Escopo de tenant

O tenant entra depois do nome do plugin, com `@`: `pluginStorage(port, 'notas', 'escola-a')` é o
namespace `notas@escola-a` (na sessão `vendas`, `vendas:notas@escola-a`). O ID do tenant vem do
transport e pode ter qualquer caractere, por isso fica no fim. Nem a sessão nem o plugin têm `@`
ou `:` (`pluginStorage` recusa os dois no nome do plugin), e o primeiro dos dois no namespace diz
de quem ele é. `<sessão>:<plugin>:<tenant>` não serviria: `escola:t1` seria tanto o tenant `t1`
do plugin `escola` na sessão `default` quanto o plugin `t1` da sessão `escola`.

O `ctx.storage` é o `tenantStorage(port, plugin, scope)`. O `TenantScope` do bot é um
`AsyncLocalStorage`: a fila de entrada roda cada mensagem no escopo do `chat.tenantId`, e o
`forward` faz o mesmo com os eventos diretos. O storage resolve o namespace a cada operação, com
cache por tenant, e o scheduler, o kernel e o `$config` não passam por ele. A mensagem sem tenant
não entra no `AsyncLocalStorage`, então não paga nada.

## Auth state (para transports)

`port.authState(session)` guarda a sessão do transport no mesmo storage (substitui o
`useMultiFileAuthState` do Baileys). A interface é genérica: credenciais são um `JsonValue` e as
chaves ficam agrupadas por tipo e id.

| Método | O que faz |
| --- | --- |
| `getCreds()` / `setCreds(creds)` | Credenciais; `undefined` antes do primeiro pareamento |
| `getKeys(type, ids)` | `{ [id]: valor }` só com os ids que existem |
| `setKeys({ [type]: { [id]: valor \| null } })` | Grava o lote; `null` remove. Atômico |
| `clear()` | Apaga credenciais e chaves da sessão (logout) |

Sessões não se enxergam entre si nem enxergam os namespaces. **Serializar `Buffer` é
responsabilidade do transport**: o storage só guarda JSON. No Baileys, com `BufferJSON`:

```ts
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from 'baileys';

const toJson = (value: unknown) => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
const fromJson = (value: unknown) => JSON.parse(JSON.stringify(value), BufferJSON.reviver);

async function authFromStorage(port: StoragePort, session: string) {
  const store = port.authState(session);
  const saved = await store.getCreds();
  const state: AuthenticationState = {
    creds: saved === undefined ? initAuthCreds() : fromJson(saved),
    keys: {
      async get(type, ids) {
        const raw = fromJson(await store.getKeys(type, ids));
        if (type === 'app-state-sync-key') {
          for (const id of Object.keys(raw)) {
            raw[id] = proto.Message.AppStateSyncKeyData.fromObject(raw[id]);
          }
        }
        return raw;
      },
      set: (data) => store.setKeys(toJson(data)),
    },
  };
  return { state, saveCreds: () => store.setCreds(toJson(state.creds)) };
}
```

## Adapters

`createMemoryStorage()` é o adapter em memória: sem estado global (cada chamada tem dados
próprios), descarta tudo no `close()`. Serve para testes e é a referência executável do
contrato.

Para produção, o adapter padrão é o `sqlite({ path })` do
[`@zapforge/storage-sqlite`](../../storage-sqlite/docs/README.md).

### Escrevendo um adapter

Implemente `StoragePort` (`forNamespace`, `authState`, `close` e, se o banco pode ser dividido
entre processos, a trava: veja [Trava com validade](#trava-com-validade)). `authState(session)` só monta o
objeto, sem I/O: o `createBot` o chama para entregar o auth à fábrica do transport
([ADR 0037](../../../docs/adr/0037-transport-por-fabrica.md)), onde não pode haver efeito
colateral; a leitura fica nos métodos. `@zapforge/core/adapter` exporta as peças que
deixam os erros e a validação iguais aos dos outros adapters:

| Função | Para quê |
| --- | --- |
| `normalizeQuery(query)` | Valida e devolve `{ where, orderBy, limit, offset }` canônico |
| `normalizeWhere(where)` | O mesmo, só para o alvo de `update`/`delete` |
| `normalizeIndexes(options)` | Campos de índice validados e sem repetição |
| `normalizeDocument(doc)` | Cópia JSON do documento/patch; recusa `id` e não-objetos |
| `cloneJson(value)` / `assertFieldName(field)` | Cópia JSON de valor de KV; validação de campo |

`where` vira uma lista de `NormalizedCondition` (`{ field, op, value }`, combinadas com E).
Nomes de campo já validados como identificadores simples podem ser interpolados em caminho
JSON (`json_extract(doc, '$.campo')`, `doc->'campo'`) sem escape. Pontos que costumam quebrar a
suíte num adapter SQL:

- Isole namespace, coleção e chave em **colunas separadas**; concatenar (`"ns:chave"`) colide.
- `json_extract` do SQLite devolve `true` como `1`: compare também o `json_type` para não casar
  `true` com `1`.
- Campo ausente e `null` são iguais; `eq`/`ne` precisam ser null-safe (`IS`/`IS NOT` no
  SQLite, `IS [NOT] DISTINCT FROM` no Postgres).
- Ordene por classe de tipo antes do valor (`CASE json_type(...)`) e desempate por uma coluna
  de sequência de inserção (`rowid`, `bigserial`), inclusive em `desc`.
- Texto por code point: `BINARY` no SQLite, `COLLATE "C"` no Postgres.
- `setKeys` numa transação; `close()` idempotente; depois dele, rejeite com
  `StorageClosedError`.

### Trava com validade

`acquireLease(name, owner, ttlMs)` e `releaseLease(name, owner)` são o que impede a mesma sessão
de rodar em dois processos sobre o mesmo banco
([ADR 0074](../../../docs/adr/0074-trava-de-sessao-entre-processos.md)). O bot trava
`session:<sessão>` no `start()` e renova chamando `acquireLease` de novo com o mesmo dono.

| Estado da trava `name` | `acquireLease(name, owner, ttlMs)` |
| --- | --- |
| Não existe ou venceu | Grava `owner` por `ttlMs`; `true` |
| É de `owner` | Renova por `ttlMs` a partir de agora; `true` |
| É de outro dono e ainda vale | Não muda nada; `false` |

`releaseLease` apaga a trava só se ela é de `owner`. A decisão precisa ser **atômica entre
processos**: um comando só (o upsert com `WHERE` do SQLite, `INSERT ... ON CONFLICT DO UPDATE
... WHERE` no Postgres) ou uma transação. Meça a validade com o relógio do banco quando ele é
dividido entre máquinas (`now()` do Postgres); o SQLite, que fica numa máquina só, usa
`Date.now()`.

Os dois métodos são opcionais no tipo só para storage que vive num processo (o de memória). A
suíte de contrato os exige, a menos que as opções digam `processLocal: true`.

### Suíte de contrato

A suíte vem num subpath próprio, fora do entry principal, e não depende de runner: recebe o
`describe`/`it` de quem roda e verifica com `node:assert`. Funciona com Vitest, Jest ou
`node:test`.

```ts
// packages/storage-sqlite/src/sqlite.contract.test.ts
import { describe, it } from 'vitest';
import { defineStorageContract } from '@zapforge/core/storage-contract';
import { sqlite } from './sqlite.ts';

defineStorageContract(
  { describe, it },
  {
    name: 'sqlite',
    create: () => sqlite({ path: ':memory:' }), // vazio e isolado: chamado por teste
    // Opcional, para adapters persistentes: fecha e reabre sobre os mesmos dados.
    reopen: async (port) => { await port.close(); return sqlite({ path: file }); },
    dispose: () => rm(file, { force: true }), // opcional: limpeza depois de cada teste
  },
);
```

Cada teste recebe um port novo e o fecha no fim. Com `reopen`, a suíte também verifica que KV,
coleções (inclusive a ordem de inserção) e auth state sobrevivem a um restart. A suíte também
cobre a [trava com validade](#trava-com-validade); um adapter que vive num processo só a dispensa
com `processLocal: true`.
