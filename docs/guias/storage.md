# Storage

O plugin guarda dados em `ctx.storage`: um **KV** para valores soltos e **coleções** para listas de
documentos. O mesmo código roda em memória, SQLite ou Postgres; quem escolhe o banco é o app. O
detalhe de cada regra está em [Storage no core](../../packages/core/docs/storage.md).

## KV

```ts
import { definePlugin } from '@zapforge/core';

export const contador = definePlugin({
  name: 'contador',
  version: '0.1.0',
  engine: '<1.0.0',
  commands: {
    conta: {
      description: 'Conta quantas vezes você chamou',
      run: async (c, { storage }) => {
        const chave = c.message.sender.id;
        const vezes = ((await storage.kv.get<number>(chave)) ?? 0) + 1;
        await storage.kv.set(chave, vezes);
        return `Você chamou ${vezes} vez(es).`;
      },
    },
  },
});
```

| Método | Retorno |
| --- | --- |
| `kv.get<T>(chave)` | O valor, ou `undefined` |
| `kv.set(chave, valor)` | Grava, substituindo |
| `kv.delete(chave)` | `true` se a chave existia |

O `storage` é só do plugin: ele não vê os dados de outro plugin, e o nome do plugin é o namespace.
Por isso o `name` do manifesto não muda entre versões.

## Valores são JSON

Tudo passa pela regra do `JSON.stringify`: `Date` vira texto, campo `undefined` some, `Buffer` não
é aceito (converta para base64). O que sai do storage é uma cópia: mudar o objeto lido não muda o
que está gravado.

## Coleções

Para uma lista que se consulta, como lembretes ou notas, use uma coleção. Declare o documento com
`type` (não `interface`):

```ts
type Lembrete = { chatId: string; quando: number; texto: string };

setup(ctx) {
  const lembretes = ctx.storage.collection<Lembrete>('lembretes', { indexes: ['quando'] });

  ctx.commands.add(
    command({
      name: 'lembretes',
      run: async (c) => {
        const proximos = await lembretes.find({
          where: { chatId: c.message.chat.id, quando: { gte: Date.now() } },
          orderBy: 'quando',
          limit: 5,
        });
        if (proximos.length === 0) return 'Nenhum lembrete.';
        return proximos.map((l) => `${new Date(l.quando).toLocaleString('pt-BR')}: ${l.texto}`).join('\n');
      },
    }),
  );
}
```

| Método | O que faz |
| --- | --- |
| `insert(doc)` | Grava e devolve o `id` gerado |
| `get(id)` | O documento, ou `undefined` |
| `find({ where, orderBy, limit, offset })` | Os documentos, cada um com `id` |
| `update(alvo, patch)` | Troca os campos do patch; devolve quantos casaram |
| `delete(alvo)` | Remove; devolve quantos removeu |

O alvo de `update` e `delete` é um `id` ou um filtro: `lembretes.delete({ chatId })`.

O filtro combina campos de primeiro nível com E. Um valor direto compara igualdade; os operadores
são `eq`, `ne`, `in`, `gt`, `gte`, `lt` e `lte`. Não há OU, campo aninhado (`'a.b'`) nem busca de
texto. `indexes` só acelera a consulta; o resultado é o mesmo sem ele. As regras de comparação
estão em [Filtros](../../packages/core/docs/storage.md#filtros-where).

## Tenants: um bot, vários clientes

Num bot que atende vários clientes do dono (escolas, empresas), o transport marca o
`chat.tenantId`. O plugin **não filtra nada**: numa mensagem de um tenant, o mesmo `ctx.storage`
lê e grava só nos dados daquele tenant. Vale também para o que o handler dispara: o service de
outro plugin, a promise solta e o job agendado.

No `setup`, e em jobs agendados no `setup`, não há tenant: o storage é o comum a todos. Para ler os
dados de um tenant de propósito, como num comando de administração, use `forTenant`:

```ts
commands: {
  resumo: {
    role: 'owner',
    run: async (c, { storage }) => {
      const escola = c.args[0] ?? '';
      if (escola === '') return 'Diga a escola: !resumo escola-a';
      const alunos = await storage.forTenant(escola).collection('alunos').find();
      return `${alunos.length} alunos`;
    },
  },
},
```

Estado em memória (um `Map` no plugin) não ganha escopo de tenant. Guarde no `ctx.storage` o que é
de um cliente. Mais em [Portabilidade → Tenant](portabilidade.md#tenant).

## Dados comuns a vários bots

Um app pode rodar vários bots no mesmo banco, um por plataforma. O `ctx.storage` de cada um é
separado. Para o que deve ser um só em todos, como um ranking, use `ctx.storage.shared`.

IDs de contato só são únicos dentro de uma plataforma: o `42` do Telegram não é o `42` do Discord.
Componha a chave com `ctx.transportName`:

```ts
run: async (c, { storage, transportName }) => {
  const chave = `${transportName}:${c.message.sender.id}`;
  const pontos = ((await storage.shared.kv.get<number>(chave)) ?? 0) + 1;
  await storage.shared.kv.set(chave, pontos);
  return `${pontos} ponto(s)`;
},
```

Não há transação: ler, somar e gravar a mesma chave em dois chats ao mesmo tempo pode perder um
incremento. Quando isso importa, guarde um documento por pessoa numa coleção.

## Testar

O kit usa o storage em memória, novo a cada `createTestBot`. Teste pelo comportamento: a mensagem
seguinte lê o que a anterior gravou.

```ts
const bot = await createTestBot({ plugins: [contador] });
await bot.receive({ text: '!conta' });
await bot.receive({ text: '!conta' });
expect(bot.sent).toContainText('Você chamou 2 vez(es).');
```

Para testar o tenant, mande a mensagem num chat com `tenantId`:

```ts
await bot.receive({ text: '!conta', chat: { id: 'a:sala', isGroup: false, tenantId: 'a' } });
```

Mais em [Testes](testes.md).
