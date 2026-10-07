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
`registry.add` (e o `ctx.commands.add` do plugin) repete a validação, então uma definição literal
que não passou por `command()` também falha no boot com `TypeError`, em vez de nunca casar. Um
`timeoutMs` que não seja finito e > 0 falha do mesmo jeito, com `RangeError`.
O nome vai **sem** o prefixo.

## No bot

O plugin registra com `ctx.commands.add(definição)` no `setup`; o `Bot` monta o roteador com
`prefix` e `owners` da config, liga `isGroupAdmin` ao transport (capability `groups`) e chama o
roteador para cada mensagem que passou pelos middlewares ([Bot](bot.md#fluxo-de-uma-mensagem)).
No teardown/reload os comandos do plugin saem sozinhos.

```ts
createBot({ transport, prefix: '!', owners: ['+55 11 99999-9999'], plugins: [media] });
```

## O roteador por dentro

Peça interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)). Como o `Bot` o monta:

```ts
import { createCommandRouter } from '#commands/router.ts';

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

Para subcomandos, use `ctx.args` direto: `const [sub, ...resto] = ctx.args`.

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

### Papéis custom

Um plugin define um papel nomeado no `setup`, e qualquer plugin o exige no comando
([ADR 0035](../../../docs/adr/0035-papeis-nomeados-por-plugin.md)). O nome é tipado por
declaration merging, como os serviços:

```ts
declare module '@zapforge/core' {
  interface Roles { moderador: true }
}

// plugin "moderacao"
setup(ctx) {
  ctx.roles.define('moderador', async (c) => {
    const lista = await ctx.storage.kv.get('moderadores');
    return Array.isArray(lista) && lista.includes(c.message.sender.id);
  });
}

// outro plugin, com dependsOn: { moderacao: '^1.0.0' }
ctx.commands.add(command({ name: 'ban', role: 'moderador', run: (c) => c.reply('banido') }));
```

- O `check(c)` recebe `message`, `text`, `command` (o comando que exige o papel), `log` (do
  plugin dono do papel) e `signal`. Só `true` concede.
- **Owner passa** em qualquer papel, sem chamar o `check`.
- **Fail-closed**: `check` que lança, rejeita ou estoura `timeouts.commandMs` recusa o comando e
  vira `plugin.error` (`phase: 'role'`, `event` = papel) **do plugin dono do papel**. No prazo, o
  `signal` aborta com `RoleTimeoutError`. Checagem síncrona não cria timer.
- Papel que nenhum plugin carregado define (dono desligado, ignorado ou recarregando) recusa o
  comando e loga um erro que pede o `dependsOn` no dono do papel.
- `owner`, `group-admin` e `everyone` são reservados (`TypeError`). Definir um papel que já tem
  dono, de outro plugin ou do mesmo, lança `RoleConflictError` (`role`, `existing`, `incoming`).
  No boot, isso derruba o `start()`, como conflito de comando ou de serviço (ADR 0035); num
  reload, o plugin recarregado fica ignorado.
- O papel sai no teardown/reload do plugin que o definiu.

Fora do bot, passe `roles` (de `createRoleRegistry()`) e, se quiser, `onUnknownRole` às opções
do roteador; o `check` cru não tem prazo nem fail-closed para erros, que viram `failed`.

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
| `failed` | `true` | `command`, `error` (de `run`, `onReject` ou `isGroupAdmin`, ou o prazo de um deles no bot) |

`command` é `{ plugin, name, invokedAs }`. Quem chama decide o destino do erro de `failed`; no
bot, vira `plugin.error` (`phase: 'command'`) e log em `error`.

O roteador em si não tem prazo. No bot, o `run` e o `onReject` de cada comando têm prazo de
`timeouts.commandMs` (padrão 30 s), contado à parte para cada um: estourado, `dispatch` devolve
`failed` com um `CommandTimeoutError` (`stage: 'run'` ou `'onReject'`), o `plugin.error` sai com
`timedOut: true` e o chat é liberado. O código segue em segundo plano; uma rejeição tardia vai
só para o log ([Bot](bot.md#fluxo-de-uma-mensagem)). A porta `isGroupAdmin` que o bot liga ao
transport tem o mesmo prazo e, estourada, rejeita com `GroupAdminTimeoutError`: o comando não
roda (`failed`), nunca é liberado por falta de resposta.

O comando que legitimamente demora (download, conversão) declara o próprio prazo com `timeoutMs`,
que vale para o `run` e o `onReject` dele. Sem `timeoutMs`, vale o `commandMs` do bot:

```ts
command({
  name: 'download',
  timeoutMs: 300_000, // yt-dlp + upload; os outros comandos seguem com o padrão
  run: async (c) => {
    const video = await baixar(c.rawArgs, { signal: c.signal });
    await c.reply.video(video);
  },
});
```

Enquanto roda, o comando segura o chat dele ([ADR 0042](../../../docs/adr/0042-handler-lento-segura-o-chat.md)):
um prazo de 5 min deixa as mensagens seguintes daquele chat esperando até 5 min. Se o grupo não
deve esperar, responda "baixando…" e solte o trabalho do `run`, como no
[padrão dos listeners](events.md#trabalho-longo-solte-o-chat). A consulta de admin e os papéis
custom seguem com o `commandMs`.

### `ctx.signal` e o que acontece depois do prazo

No bot, o contexto do `run` traz `signal: AbortSignal`, que aborta quando o prazo estoura
(`reason` = o `CommandTimeoutError`) ou quando o plugin é descartado (teardown, reload), com o
motivo do descarte. Repasse-o a `fetch` e SDKs, para o trabalho parar junto
([ADR 0033](../../../docs/adr/0033-cancelamento-cooperativo.md)):

```ts
command({
  name: 'resumo',
  run: async (c) => {
    const texto = await ia.resumir(c.rawArgs, { signal: c.signal });
    await c.reply(texto);
  },
});
```

Depois do prazo, `c.reply(...)` (e `c.reply.image(...)` etc., mesmo guardado antes) rejeita com
`ContextExpiredError` sem chegar ao transport, com uma linha `warn` (plugin e comando). O
`ctx.send`/`ctx.storage` do `setup` são do plugin e não sabem do prazo do comando: confira
`c.signal.aborted` (ou `c.signal.throwIfAborted()`) antes de efeitos que não recebem o `signal`.
Código síncrono travado bloqueia o processo inteiro, e nenhum prazo resolve isso.

O `onReject` recebe o próprio `signal`, que aborta quando o prazo dele estoura, e o `reply` dele
segue a mesma regra. Fora do bot, o roteador não cria `signal`: quem chama `dispatch` o fornece
no contexto, como `reply` e `log`.

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
