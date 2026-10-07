# Services entre plugins

Um plugin publica um serviço com `ctx.services.provide(name, impl)` e outro o consome com
`ctx.services.get(name)`, sem importar um ao outro. É assim que a IA fica fora do core
([ADR 0018](../../../docs/adr/0018-service-registry.md), [ADR 0006](../../../docs/adr/0006-luma-e-um-plugin.md)).

## Prover

O plugin que provê declara o tipo por declaration merging na interface `Services` do
`@zapforge/core` e publica a implementação no `setup` (`definePlugin` chega no M1-8):

```ts
import { definePlugin } from '@zapforge/core';

export interface AiService {
  complete(prompt: string): Promise<string>;
}

declare module '@zapforge/core' {
  interface Services {
    ai: AiService;
  }
}

export const ai = definePlugin({
  name: 'ai',
  version: '1.0.0',
  engine: '^1.0.0',
  setup(ctx) {
    ctx.services.provide('ai', { complete: async (prompt) => /* ... */ prompt });
  },
});
```

O `declare module` precisa mirar `'@zapforge/core'`, o mesmo especificador que o plugin
importa. `provide` só aceita nomes declarados em `Services` e a implementação com o tipo
declarado; nome desconhecido não compila.

## Consumir

Quem consome declara `dependsOn` no provedor (o boot carrega as dependências antes) e chama
`get`, que já devolve o tipo certo:

```ts
export const resumo = definePlugin({
  name: 'resumo',
  version: '1.0.0',
  engine: '^1.0.0',
  dependsOn: { ai: '^1.0.0' },
  setup(ctx) {
    const ai = ctx.services.get('ai'); // AiService
  },
});
```

O tipo vem de importar o pacote do provedor (ou só o tipo dele): é esse import que traz o
`declare module` para o programa do consumidor.

- **`get` no `setup` pode**: o boot segue a ordem topológica do `dependsOn`, então o
  provedor já rodou o `setup` dele (e o `provide`). Também pode ser chamado depois, em
  comandos e listeners.
- **Serviço opcional**: `ctx.services.has('ai')` responde sem lançar.
- **Serviço ausente**: `get` lança `ServiceNotFoundError` dizendo qual serviço, qual plugin
  pediu e que nenhum plugin carregado o provê, sugerindo declarar o `dependsOn`. O erro tem
  os campos `service` e `requestedBy`.

## Regras

- **Um provedor por nome.** Se outro plugin já provê o nome, `provide` lança
  `ServiceConflictError` citando os dois plugins (campos `service`, `existing`, `incoming`),
  e o primeiro continua valendo.
- **Sem re-prover.** O mesmo plugin chamar `provide` duas vezes para o mesmo nome também é
  `ServiceConflictError`: quem já fez `get` ficaria com a instância antiga sem saber. Trocar a
  implementação é recarregar o plugin.
- **Teardown e reload** removem o que o plugin proveu; no novo `setup` ele provê de novo. Um
  consumidor que guardou a instância no `setup` continua com a antiga; se o provedor pode
  recarregar, chame `get` na hora do uso.

## Registry

O `Bot` cria um registry por instância (sem estado global) e entrega a cada plugin o acesso
atribuído a ele (`ctx.services`); no teardown/reload remove o que o plugin proveu. Fora do bot,
quem compõe faz isso direto:

```ts
import { createServiceRegistry } from '@zapforge/core';

const services = createServiceRegistry();

const aiServices = services.forPlugin('ai');         // o ctx.services do plugin 'ai'
aiServices.provide('ai', aiService);

services.forPlugin('resumo').get('ai');
services.list();                                     // [{ plugin: 'ai', name: 'ai', service }]
services.removePlugin('ai');                         // teardown/reload
```
