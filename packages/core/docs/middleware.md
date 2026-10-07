# Middlewares

Primeiro estágio do fluxo de uma mensagem ([ADR 0012](../../../docs/adr/0012-pipeline-de-3-estagios.md)):
middlewares → comando → listeners. Um middleware vê o contexto antes de todo o resto e pode
barrar a mensagem, enriquecer o contexto ou medir o que acontece depois dele.

## Escrevendo um middleware

```ts
import { type Middleware, MiddlewarePipeline } from '@zapforge/core';

const timing: Middleware = async (ctx, next) => {
  const start = performance.now();
  await next(); // roda o resto da cadeia (e, no kernel, comando/listeners)
  console.log(ctx.message.id, performance.now() - start);
};

const onlyText: Middleware = (ctx, next) => {
  if (ctx.message.type !== 'text') return; // não chamar next() interrompe a cadeia
  return next();
};
```

Regras:

- **Onion (estilo Koa)**: o código antes de `next()` roda na ida, o depois de `await next()` na
  volta, em ordem inversa.
- **Interromper** = não chamar `next()`. A mensagem não segue para os próximos middlewares
  (nem, no kernel, para comando e listeners).
- **Sempre `await next()`** (ou `return next()`): sem isso, erros dos internos se perdem e o
  pipeline pode terminar antes deles.
- **`next()` duas vezes** rejeita com erro.
- **Erros** (síncronos ou não) propagam: rejeitam o `run()`. Um middleware de fora pode
  capturá-los com `try { await next() } catch …`.
- O middleware é genérico no contexto: `Middleware<C extends MessageContext>`. No bot, o contexto
  é um `BotMessageContext` (`message`, `text`, `reply`, `log`).

## O texto de trabalho `ctx.text`

`ctx.message` é imutável. Para mudar o que os estágios seguintes leem — truncar, normalizar,
tirar uma menção do começo —, reescreva `ctx.text`:

```ts
const semMencao: Middleware<BotMessageContext> = (ctx, next) => {
  ctx.text = ctx.text?.replace(/^@\S+\s*/, '') ?? null;
  return next();
};
```

No bot, `ctx.text` começa igual a `message.text`; o roteador casa os comandos por ele e os
listeners o recebem em `e.text`. Fora do bot o campo é opcional (`MessageContext.text?`): quem lê
usa `ctx.text` se definido, senão `message.text`.

## No bot

O `Bot` monta o pipeline com os oficiais e os do app (`createBot({ middlewares })`), na ordem e
com os padrões descritos em [Bot → Middlewares](bot.md#middlewares): `ignoreSelf` e `sanitize`
ligados, `chatFilter` e `rateLimit` quando configurados. Erro de middleware vai para o log com o
`chatId`; a mensagem para ali e o chat segue.

## Pipeline

```ts
const pipeline = new MiddlewarePipeline();
const remove = pipeline.use(timing, { priority: 100 });
pipeline.use(onlyText);

const passed = await pipeline.run({ message }); // true: atravessou; false: interrompida
remove(); // idempotente
```

- **Prioridade**: maior roda antes (mais por fora). Padrão `0`, aceita negativos. Empate segue
  a ordem de registro. Valor não finito lança `RangeError`.
- `run(ctx)` resolve `true` se todos chamaram `next()` até o fim — é o sinal para o kernel seguir
  para comando/listeners — e `false` se algum interrompeu.
- A ordem é calculada em `use()`/remoção, não por mensagem. Uma mensagem em andamento usa a
  cadeia de quando começou: registrar ou remover no meio não a afeta.

## Middlewares oficiais

Todos são fábricas; registre com a prioridade que quiser. Ordem sugerida (de fora para dentro):

```ts
import { chatFilter, ignoreSelf, rateLimit, sanitize } from '@zapforge/core';

pipeline.use(ignoreSelf(), { priority: 1000 });
pipeline.use(chatFilter({ block: ['123@g.us'] }), { priority: 900 });
pipeline.use(rateLimit({ max: 10, windowMs: 1000 }), { priority: 800 });
pipeline.use(sanitize(), { priority: 700 });
```

### `ignoreSelf()`

Barra mensagens com `message.fromMe` (enviadas pela própria sessão do bot).

### `chatFilter({ allow?, block? })`

Allow/blocklist por `chat.id`. Com `allow`, só os chats listados passam; `block` barra sempre e
vence `allow`. As listas são copiadas na criação: para mudar, recrie o middleware (remova e
registre de novo).

### `rateLimit({ max, windowMs, by?, onLimited?, clock? })`

Janela fixa por chave: até `max` mensagens a cada `windowMs`; o excedente é barrado e
`onLimited(ctx)` é chamado (erro nele propaga para quem roda o pipeline).

| `by` | Chave |
| --- | --- |
| `'sender'` (padrão) | remetente, somando todos os chats |
| `'chat'` | chat, somando todos os remetentes |
| `'sender-in-chat'` | remetente em cada chat |

As janelas vencidas são removidas a cada mensagem, então a memória fica limitada às chaves
ativas na última janela. `clock` (padrão `performance.now`, monotônico) existe para testes.
O contador sozinho está disponível como `RateLimiter` (`hit(key)`, `size`).

### `sanitize({ maxTextLength?, maxSenderNameLength? })`

Trunca o texto de trabalho (padrão 4096) e o nome do remetente (padrão 100), sem cortar emoji
ao meio. Como `ctx.message` é imutável, o texto truncado vai para `ctx.text` — o que o roteador e
os listeners leem — e, junto do nome, para `ctx.sanitized`, tipado por `SanitizedContext`:

```ts
const pipeline = new MiddlewarePipeline<SanitizedContext>();
pipeline.use(sanitize());
// adiante:
ctx.text;                 // texto truncado
ctx.sanitized?.senderName; // nome truncado
```

Ele trunca o `ctx.text` que recebeu (de um middleware anterior, se houver), não o
`message.text` original. Até o M1-16 o texto truncado só ia para `ctx.sanitized.text`, que
continua preenchido com o mesmo valor.
