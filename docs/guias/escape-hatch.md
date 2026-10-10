# Escape hatch

A API do core cobre o que as plataformas têm em comum. Quando o plugin precisa de algo que só uma
tem (os embeds do Discord, o status online do WhatsApp), ele usa o escape hatch: `ctx.unsafe` dá o
objeto da biblioteca da plataforma. O preço é o plugin ficar preso a ela. O detalhe está em
[Escape hatch no core](../../packages/core/docs/unsafe.md).

Antes de usar, confira se a API normalizada não resolve: reações, edição, grupos, botões e enquete
já têm caminho próprio. E se o que falta é comum a várias plataformas, a lacuna é do core: abra uma
issue.

## Declare o transport

O plugin que usa o escape hatch declara para qual transport foi feito. Em outro transport, o loader
o deixa fora no boot, em vez de ele quebrar em runtime:

```ts
export const embeds = definePlugin({
  name: 'embeds',
  version: '0.1.0',
  engine: '<1.0.0',
  transports: ['discord'],
  // ...
});
```

Sem `transports`, o primeiro uso loga um aviso sugerindo a declaração.

## O objeto bruto da mensagem: `ctx.unsafe.raw(message)`

Devolve a mensagem no formato da plataforma, com o que a `Message` normalizada não representa. No
Discord, um embed:

```ts
import { command, definePlugin } from '@zapforge/core';
import type { Message as DiscordMessage } from 'discord.js';

export const embeds = definePlugin({
  name: 'embeds',
  version: '0.1.0',
  engine: '<1.0.0',
  transports: ['discord'],
  setup(ctx) {
    ctx.commands.add(
      command({
        name: 'embeds',
        run: (c) => {
          const raw = ctx.unsafe.raw(c.message.quoted ?? c.message) as DiscordMessage | undefined;
          if (raw === undefined) return 'Não achei a mensagem original.';
          return raw.embeds.map((e) => e.title ?? '(sem título)').join('\n') || 'Sem embeds.';
        },
      }),
    );
  },
});
```

No WhatsApp (`transports: ['baileys']`), o objeto é o `WAMessage` do Baileys:

```ts
import type { WAMessage } from 'baileys';

const raw = ctx.unsafe.raw(c.message) as WAMessage | undefined;
const pushName = raw?.pushName;
```

- **O retorno é `unknown`.** Estreite com o tipo da biblioteca do transport que você declarou.
- **Pode vir `undefined`**: o transport não guarda o bruto, ou a mensagem não veio dele (montada
  num teste, lida do storage, uma cópia `{ ...message }`). Trate esse caso.
- **Clique e comando nativo** devolvem o objeto da interação (a interação do Discord, a
  `callback_query` do Telegram).
- **Use na hora.** Não guarde o objeto: o transport o solta junto com a mensagem.

O transport web não tem objeto bruto: lá, `raw()` sempre devolve `undefined`. O que o sistema de
origem verificou sobre o usuário chega pelos `claims` do remetente.

## O cliente da plataforma: `ctx.unsafe.native`

Dá o objeto principal da biblioteca: o socket do Baileys, o `Client` do discord.js.

```ts
import type { WASocket } from 'baileys';

setup(ctx) {
  ctx.commands.add(
    command({
      name: 'online',
      role: 'owner',
      run: async () => {
        const socket = ctx.unsafe.native as WASocket; // leia na hora de usar
        await socket.sendPresenceUpdate('available');
        return 'Agora apareço online.';
      },
    }),
  );
}
```

Leia `ctx.unsafe.native` a cada uso, sem guardar a referência: o objeto pode ser trocado numa
reconexão, e o getter devolve sempre o atual.

## O aviso no log

O primeiro uso de `native` e o primeiro de `raw()` por um plugin logam um `warn` com o plugin e o
transport. O aviso é de propósito: ele mostra o que os plugins buscam fora da API, e é isso que
vira API oficial depois.

## Testar

O transport falso do kit se chama `fake`, então o plugin com `transports: ['discord']` fica fora do
boot nele. Teste uma cópia sem `transports`, com um objeto bruto falso na mensagem:

```ts
const { transports: _, ...embedsSemTransport } = embeds;
const bot = await createTestBot({ plugins: [embedsSemTransport] });
await bot.receive({ text: '!embeds', raw: { embeds: [{ title: 'Placar' }] } });
expect(bot.sent).toHaveReplied('Placar');
```

Sem `raw`, o `ctx.unsafe.raw()` devolve `undefined`. O `click()` aceita `raw` nas opções, para a
interação do clique. O `native` do transport falso não é o de nenhuma plataforma; um plugin que
depende dele se testa melhor com a lógica separada da chamada nativa. Mais em [Testes](testes.md).
