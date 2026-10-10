# Escape hatch `ctx.unsafe`

Saída explícita para quando a API normalizada ainda não cobre o que o plugin precisa
([ADR 0011](../../../docs/adr/0011-escape-hatch-unsafe-native.md),
[ADR 0066](../../../docs/adr/0066-objeto-bruto-da-mensagem.md)). Dá acesso ao objeto nativo do
transport em `native` (o socket do Baileys, o `Client` do discord.js, o `Bot` do grammY), e ao
objeto bruto de cada mensagem em `raw()`.

## Usando num plugin

```ts
import type { Client } from 'discord.js';

export const plugin = definePlugin({
  name: 'servidores',
  version: '1.0.0',
  engine: '^0.1.0',
  transports: ['discord'], // o uso do escape hatch prende o plugin a este transport
  setup(ctx) {
    const client = ctx.unsafe.native as Client; // `unknown`: estreite antes de usar
  },
});
```

No `transport-baileys`, o mesmo acesso dá o socket:

```ts
import type { WASocket } from 'baileys';

const socket = ctx.unsafe.native as WASocket; // com `transports: ['baileys']` no manifesto
```

- `native` é `unknown`: o core não promete nada sobre o formato. Estreite (cast ou checagem)
  sabendo para qual transport o plugin foi feito.
- Leia `ctx.unsafe.native` **na hora de usar**, não guarde a referência: o objeto nativo pode ser
  trocado a cada reconexão, e o getter sempre devolve o atual.
- O acesso nunca é bloqueado.

## O objeto bruto da mensagem: `ctx.unsafe.raw(message)`

Devolve o objeto de onde a mensagem saiu, no formato da plataforma: o que o contrato não
representa, como componentes e embeds no Discord, ou `entities` e `reply_markup` no Telegram.

```ts
import type { Message as DiscordMessage } from 'discord.js';

export const plugin = definePlugin({
  name: 'embeds',
  version: '1.0.0',
  engine: '^0.1.0',
  transports: ['discord'],
  setup(ctx) {
    ctx.commands.add(
      command({
        name: 'embeds',
        run: (c) => {
          const raw = ctx.unsafe.raw(c.message) as DiscordMessage | undefined;
          if (raw === undefined) return c.reply('sem o objeto do Discord');
          return c.reply(`${raw.embeds.length} embed(s)`);
        },
      }),
    );
  },
});
```

No Baileys, é o `WAMessage` (`proto.IWebMessageInfo`):

```ts
import type { WAMessage } from 'baileys';

const raw = ctx.unsafe.raw(c.message) as WAMessage | undefined;
const pushName = raw?.pushName;
```

- Devolve `unknown`, como o `native`: estreite sabendo para qual transport o plugin foi feito.
- `undefined` quando o transport não implementa `raw` ou a mensagem não veio dele: montada em
  teste, pelo próprio plugin, ou lida do storage. Trate esse caso.
- Vale para `c.message`, para a citada (`c.message.quoted`) e para a versão do
  `message.edited`, quando o transport as registra. No Baileys, a citada devolve o proto montado
  do `contextInfo`, sem `pushName` nem horário.
- A mensagem de um clique num botão ou de um comando nativo devolve o objeto bruto da
  **interação** (o token de interação no Discord, a `callback_query` no Telegram).
- A busca é pela identidade do objeto: uma cópia (`{ ...message }`) devolve `undefined`. Passe a
  `Message` que o kernel entregou.
- Não guarde o objeto por muito tempo: o transport o solta junto com a mensagem.

## O aviso no log

A primeira leitura de `native` por um plugin loga, em nível `warn`, o nome do plugin e do
transport (também nos campos `plugin` e `transport`). As leituras seguintes do mesmo plugin
não logam de novo, mesmo vindas de outros contextos. O `raw()` segue a mesma regra, com um
aviso à parte: o plugin que usa os dois avisa uma vez para cada. O registro é por bot: dois bots no mesmo
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

// um por bot; `interactionOf` acha a interação de onde o kernel montou a mensagem
const unsafeAccess = createUnsafeAccess({ transport, log, interactionOf });
const unsafe = unsafeAccess.forPlugin(manifest); // quantos quiser por plugin
```

`forPlugin` usa só `name` e `transports` do manifesto. O `raw()` chama `transport.raw` com a
interação de origem, se `interactionOf` achar uma, ou com a própria mensagem; o `Bot` guarda essa
relação num `WeakMap` dele. O estado "já avisou" fica na instância
devolvida por `createUnsafeAccess`, nunca em escopo de módulo.
