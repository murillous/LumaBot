# Escape hatch `ctx.unsafe.native`

Saída explícita para quando a API normalizada ainda não cobre o que o plugin precisa
([ADR 0011](../../../docs/adr/0011-escape-hatch-unsafe-native.md)). Dá acesso ao objeto
nativo do transport (no Baileys, o socket).

## Usando num plugin

```ts
import type { WASocket } from 'baileys';

export const plugin = definePlugin({
  name: 'stickers',
  version: '1.0.0',
  engine: '^0.1.0',
  transports: ['baileys'], // o uso do escape hatch prende o plugin a este transport
  setup(ctx) {
    const socket = ctx.unsafe.native as WASocket; // `unknown`: estreite antes de usar
  },
});
```

- `native` é `unknown`: o core não promete nada sobre o formato. Estreite (cast ou checagem)
  sabendo para qual transport o plugin foi feito.
- Leia `ctx.unsafe.native` **na hora de usar**, não guarde a referência: o objeto nativo pode ser
  trocado a cada reconexão, e o getter sempre devolve o atual.
- O acesso nunca é bloqueado.

## O aviso no log

A primeira leitura de `native` por um plugin loga, em nível `warn`, o nome do plugin e do
transport (também nos campos `plugin` e `transport`). As leituras seguintes do mesmo plugin
não logam de novo, mesmo vindas de outros contextos. O registro é por bot: dois bots no mesmo
processo avisam cada um.

Se o manifesto não declara `transports`, o aviso diz que o plugin ficou preso ao transport
atual e sugere `transports: ['<nome>']`. Declare para que o loader recuse o plugin em outro
transport, em vez de ele quebrar em runtime.

O aviso serve de medição: o que os plugins buscam no `native` indica o que promover a API
oficial.

## Para quem monta o contexto (kernel)

Peça interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)).

```ts
import { createUnsafeAccess } from '#unsafe/access.ts';

const unsafeAccess = createUnsafeAccess({ transport, log }); // um por bot
const unsafe = unsafeAccess.forPlugin(manifest); // quantos quiser por plugin
```

`forPlugin` usa só `name` e `transports` do manifesto. O estado "já avisou" fica na instância
devolvida por `createUnsafeAccess`, nunca em escopo de módulo.
