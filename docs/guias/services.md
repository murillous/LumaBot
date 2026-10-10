# Services

Um plugin oferece uma funcionalidade a outros sem que eles o importem: o plugin de IA provê o
service `ai`, e o de resumo o consome. Quem consome não sabe qual plugin está por trás. O detalhe
está em [Services no core](../../packages/core/docs/services.md).

## Prover

O provedor declara o tipo do service na interface `Services` do `@zapforge/core` e o publica no
`setup`:

```ts
import { definePlugin } from '@zapforge/core';

export interface TraducaoService {
  traduzir(texto: string, idioma: string): Promise<string>;
}

declare module '@zapforge/core' {
  interface Services {
    traducao: TraducaoService;
  }
}

export const traducao = definePlugin({
  name: 'traducao',
  version: '1.0.0',
  engine: '<1.0.0',
  setup(ctx) {
    ctx.services.provide('traducao', {
      traduzir: async (texto, idioma) => chamarApi(texto, idioma),
    });
  },
});
```

O `declare module` mira `'@zapforge/core'`, o mesmo nome que o plugin importa. Com ele, `provide`
só aceita o nome declarado e a implementação com o tipo certo.

## Consumir

Quem consome declara `dependsOn` no provedor. O boot carrega o provedor antes, então o `get` já
funciona no `setup`:

```ts
import { command, definePlugin } from '@zapforge/core';
import type {} from 'zapforge-plugin-traducao'; // traz o `declare module` para o tipo do `get`

export const ingles = definePlugin({
  name: 'ingles',
  version: '1.0.0',
  engine: '<1.0.0',
  dependsOn: { traducao: '^1.0.0' },
  setup(ctx) {
    const traducao = ctx.services.get('traducao'); // TraducaoService
    ctx.commands.add(
      command({
        name: 'en',
        run: async (c) => traducao.traduzir(c.rawArgs, 'en'),
      }),
    );
  },
});
```

- **O tipo vem do pacote do provedor.** Importar o pacote, ou só um tipo dele, traz a declaração
  de `Services` para o consumidor.
- **Sem o provedor, o consumidor não sobe.** O `dependsOn` faz o boot ignorar o consumidor, com o
  motivo na tabela de boot, em vez de ele falhar em runtime.
- **Service opcional:** sem `dependsOn`, confira com `ctx.services.has('traducao')` antes do
  `get`. Sem o provedor, `get` lança `ServiceNotFoundError`. Para garantir a ordem de carga sem
  exigir o provedor, use `after: ['traducao']`.

## Regras

- **Um provedor por nome.** Dois plugins provendo `traducao` derrubam o boot com
  `ServiceConflictError`, citando os dois.
- **Reload em cascata.** Quando o provedor recarrega (mudou a config, por exemplo), quem declara
  `dependsOn` nele recarrega junto. Guardar o service no `setup`, como no exemplo, é seguro.
- **Tenant.** Chamado numa mensagem de um tenant, o service roda no escopo dele: o `ctx.storage`
  do provedor grava nos dados daquele tenant sem receber nada
  ([Storage → Tenants](storage.md#tenants-um-bot-vários-clientes)).

## Service ou import?

Use service quando a implementação pode ser trocada (IA de outro fornecedor) ou quando o
provedor tem estado ligado ao bot (config, storage, conexão). Uma função pura, sem estado, pode
ser só um pacote npm comum que os plugins importam.

## Testar

Suba o provedor e o consumidor juntos, ou um provedor falso no lugar do real:

```ts
const traducaoFalsa = definePlugin({
  name: 'traducao',
  version: '1.0.0',
  engine: '<1.0.0',
  setup(ctx) {
    ctx.services.provide('traducao', { traduzir: async (texto) => `[en] ${texto}` });
  },
});

const bot = await createTestBot({ plugins: [traducaoFalsa, ingles] });
await bot.receive({ text: '!en bom dia' });
expect(bot.sent).toHaveReplied('[en] bom dia');
```

Mais em [Testes](testes.md).
