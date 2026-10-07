# Comandos

O roteador é o 2º estágio do pipeline ([ADR 0012](../../../docs/adr/0012-pipeline-de-3-estagios.md)):
depois dos middlewares, antes dos listeners. Se a mensagem invoca um comando, ele valida papel e
`accepts`, roda o comando e **consome** a mensagem — ela não chega aos listeners.

## Declarar um comando

```ts
import { command } from '@zapforge/core';

const sticker = command({
  name: 'sticker',
  aliases: ['s'],
  description: 'Transforma imagem ou vídeo em figurinha',
  accepts: ['image', 'video', 'quoted:image', 'quoted:video'],
  onReject: () => 'Mande ou responda uma imagem/vídeo 🙂',
  role: 'everyone',
  run: async (ctx) => {
    const buffer = await ctx.media!.download(); // própria mensagem OU citada, já resolvido
    // ...
  },
});
```

`command()` valida nome e aliases na hora (não vazios, sem espaço) e devolve a definição.
O nome vai **sem** o prefixo.

## No bot

O plugin registra com `ctx.commands.add(definição)` no `setup`; o `Bot` monta o roteador com
`prefix` e `owners` da config, liga `isGroupAdmin` ao transport (capability `groups`) e chama o
roteador para cada mensagem que passou pelos middlewares ([Bot](bot.md#fluxo-de-uma-mensagem)).
No teardown/reload os comandos do plugin saem sozinhos.

```ts
createBot({ transport, prefix: '!', owners: ['+55 11 99999-9999'], plugins: [media] });
```

## Montar o roteador (fora do bot)

```ts
import { createCommandRouter } from '@zapforge/core';

const router = createCommandRouter({
  prefix: '!',                         // padrão '!'; não pode ser vazio
  owners: ['5511999999999'],           // já normalizados (normalizeOwners)
  isGroupAdmin: async (chatId, senderId) => {
    const { participants } = await transport.getGroupMetadata(chatId);
    return participants.some((p) => p.id === senderId && p.isAdmin);
  },
});

router.registry.add('media', sticker); // 1º argumento: o plugin dono do comando

const result = await router.dispatch(ctx); // ctx: MessageContext
if (!result.consumed) {
  // não era comando: segue para os listeners
}
```

O roteador herda o contexto recebido: `reply` e `log` do `CommandContext` são os do contexto que
o `Bot` monta. Quem usa o roteador solto e quer esses campos os põe no `ctx` passado a
`dispatch`.

## Match

- O texto é o **texto de trabalho** `ctx.text` (no bot, o texto ou legenda da mídia depois dos
  middlewares — truncado pelo `sanitize`, por exemplo), sem os espaços iniciais. Sem `ctx.text`
  no contexto, vale `message.text`; `ctx.text === null` nunca é comando.
- Começa com o prefixo? O **token** é o trecho do fim do prefixo até o primeiro espaço em
  branco. Ele casa por igualdade exata com um nome ou alias registrado — nunca por
  `includes()`/`startsWith()`, então `vou mandar !sticker`, `!stickers` e `!sabado` (com alias
  `s`) não casam.
- **Sem diferenciar caixa** no prefixo e no token: `!Sticker` e `!STICKER` casam com `sticker`.
  Teclado de celular capitaliza a primeira letra sozinho, e o legacy já comparava em
  minúsculas. Os argumentos mantêm a caixa original.
- `! sticker` (espaço depois do prefixo) não é comando.

## Argumentos

O contexto do `run` (`CommandContext`) estende `MessageContext` com:

| Campo | Conteúdo |
| --- | --- |
| `text` | Texto de trabalho que casou (ver [Match](#match)) |
| `reply` | Responde no chat, citando a mensagem, pela fila de saída |
| `log` | Logger com `plugin` (o dono do comando) e `chatId` |
| `command` | Nome canônico do comando casado |
| `invokedAs` | Token digitado (nome ou alias), em minúsculas |
| `args` | Argumentos já quebrados (ver abaixo) |
| `rawArgs` | Texto após o token, sem o espaço inicial, com quebras de linha |
| `accepted` | `{ spec, message }` da entrada de `accepts` que casou, ou `null` |
| `media` | Mídia resolvida, ou `null` |

`args` quebra por qualquer espaço em branco (inclusive quebra de linha). Trecho entre aspas
vira um argumento só, sem as aspas: `!persona criar "Luma séria"` → `['criar', 'Luma séria']`.

- Valem `"..."` e as tipográficas `“...”` (o iOS troca uma pela outra).
- Aspas simples **não** agrupam: o apóstrofo aparece em texto comum (`d'água`).
- `""` gera argumento vazio; aspa sem fechamento vai até o fim do texto.
- Sem escape (`\"`): quem precisa do texto literal usa `rawArgs`.

`parseArgs(texto)` é exportado para quem quiser o mesmo parse em subcomandos.

## `accepts` e `ctx.media`

Cada entrada é um `MessageType` da própria mensagem (`'image'`) ou da citada
(`'quoted:image'`). A **primeira entrada que casar, na ordem declarada**, vence e define
`ctx.accepted` e `ctx.media` (a mídia daquela mensagem; `null` para tipos sem mídia, como
`'quoted:text'`). Para preferir a mídia própria, liste os tipos próprios antes dos `quoted:*`.

Sem `accepts`, qualquer mensagem passa; `ctx.media` é a mídia própria ou, na falta dela, a da
citada.

## `role`

| Papel | Quem roda |
| --- | --- |
| `everyone` (padrão) | Todo mundo |
| `owner` | Remetente cujo `sender.phone` está em `owners` |
| `group-admin` | Admin do grupo, segundo a porta `isGroupAdmin(chatId, senderId)` |

- Owner passa também em `group-admin`.
- `group-admin` fora de grupo é recusado (não há grupo a que o papel se refira).
- Sem `isGroupAdmin` (transport sem a capability `groups`), `group-admin` recusa todo mundo
  exceto owners: falha fechada, nunca libera por falta de informação.
- `owners` são telefones só com dígitos e DDI (`'5511999999999'`), comparados por igualdade com
  `message.sender.phone`. O bot normaliza a lista da config com `normalizeOwners`, então lá vale
  `'+55 (11) 99999-9999'`; no roteador solto, normalize antes.
- Não se usa `sender.id`: no WhatsApp ele pode ser um LID, de onde não sai o telefone. Só o
  transport sabe resolver o número; quando não sabe, `phone` é `null` e esse remetente **nunca**
  é owner.

Papéis custom são middleware ([ADR 0024](../../../docs/adr/0024-papeis-no-core.md)).

## Recusa e `onReject`

A ordem é: papel → `accepts` → `run`. Na recusa, o roteador chama
`onReject(ctx, rejection)`, com `rejection` igual a `{ reason: 'role', required }` ou
`{ reason: 'accepts', accepts }`. O texto retornado volta em `result.reply`; no bot, ele sai pelo
`ctx.reply` (citando a mensagem). Sem `onReject`, ou retornando
`null`/`undefined`, a recusa é silenciosa (`reply: null`). Comando recusado também consome a
mensagem.

## Resultado de `dispatch`

`dispatch` nunca rejeita a promise. O resultado diz o que aconteceu:

| `status` | `consumed` | Extra |
| --- | --- | --- |
| `no-match` | `false` | — |
| `ran` | `true` | `command` |
| `rejected` | `true` | `command`, `rejection`, `reply` |
| `failed` | `true` | `command`, `error` (de `run`, `onReject` ou `isGroupAdmin`) |

`command` é `{ plugin, name, invokedAs }`. Quem chama decide o destino do erro de `failed`; no
bot, vira `plugin.error` (`phase: 'command'`) e log em `error`.

## Conflitos

Nome e aliases são únicos no bot inteiro, sem diferenciar caixa. `registry.add` lança
`CommandConflictError` se algum token já pertence a outro comando — de outro plugin ou do mesmo —
e não registra nada do comando recusado. O erro traz `token`, `existing` e `incoming` (cada um
com `plugin` e `definition`), e a mensagem cita os dois plugins:

```
Conflito de comando "s": "search" do plugin "busca" colide com "sticker" do plugin "media".
```

Como os comandos são registrados no `setup` dos plugins, o conflito derruba o boot: o `Bot`
encerra o que subiu e o `start()` rejeita com o `CommandConflictError`. Alias
repetido ou igual ao próprio nome dentro do mesmo comando é inofensivo e não conta.

`registry.removePlugin(nome)` tira todos os comandos de um plugin (teardown e reload).
