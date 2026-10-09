# Middlewares

Primeiro estágio do fluxo de uma mensagem ([ADR 0012](../../../docs/adr/0012-pipeline-de-3-estagios.md)):
middlewares → comando → listeners. Um middleware vê o contexto antes de todo o resto e pode
barrar a mensagem, enriquecer o contexto ou medir o que acontece depois dele.

## Escrevendo um middleware

```ts
import type { Middleware } from '@zapforge/core';

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
  volta, em ordem inversa. No bot, comando e listeners são o centro da cebola: a volta só
  começa depois que eles terminam (ou estouram o prazo, `timeouts.commandMs`/`listenerMs`).
- **Interromper** = não chamar `next()`. A mensagem não segue para os próximos middlewares
  (nem, no kernel, para comando e listeners).
- **Sempre `await next()`** (ou `return next()`): sem isso, erros dos internos se perdem e o
  pipeline pode terminar antes deles.
- **`next()` duas vezes** rejeita com erro.
- **Erros** (síncronos ou não) propagam: rejeitam o `run()`. Um middleware de fora pode
  capturá-los com `try { await next() } catch …`. No bot, comando e listeners não lançam para
  o middleware: erro de plugin vira `plugin.error` ([Bot](bot.md#fluxo-de-uma-mensagem)).
- O middleware é genérico no contexto: `Middleware<C extends MessageContext>`. No bot, o contexto
  é um `BotMessageContext` (`message`, `text`, `reply`, `log`).
- No bot, **edições** (`message.edited`) também passam pelos middlewares. Quem só quer mensagem
  nova confere `ctx.message.isEdited` ([Bot](bot.md#fluxo-de-uma-mensagem)).
- No bot, **cada middleware tem prazo** (ver [Prazo](#prazo)).

## Prazo

O middleware roda dentro da tarefa da fila do chat: preso, ele seguraria as próximas mensagens
daquele chat. Por isso, no bot, cada um tem `timeouts.middlewareMs` (padrão 30 s;
[ADR 0043](../../../docs/adr/0043-prazo-de-middleware.md)).

- O relógio conta **só o tempo do próprio middleware**. Ele para no `next()` e volta, com o que
  sobrou, quando o `next()` termina: um comando lento lá dentro não estoura o middleware de fora.
  Ida e volta do mesmo middleware dividem um prazo só.
- Estourado, a mensagem é descartada: o erro (`MiddlewareTimeoutError`) vai para o log
  (`falha ao processar mensagem`) e a próxima mensagem do chat segue. Um `next()` chamado depois
  disso rejeita com o mesmo erro, sem rodar comando nem listeners.
- O JS não cancela promise: o middleware estourado continua rodando em segundo plano. Se ele
  rejeitar depois, o erro vai para o log (`middleware rejeitou depois do prazo`).
- Middleware síncrono, ou que só devolve o `next()` (`return next()`), não arma timer.
- Trabalho que precisa de mais tempo se solta do middleware (sem `await`, com `catch` próprio)
  ou sobe `timeouts.middlewareMs`, que vale para todos.

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

`MiddlewarePipeline` é peça interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)); o app passa os middlewares em
`createBot({ middlewares })`. Para quem mexe no core:

```ts
import { MiddlewarePipeline } from '#middleware/pipeline.ts';

// timeoutMs liga o prazo por middleware; onLateError recebe a rejeição tardia.
const pipeline = new MiddlewarePipeline({ timeoutMs: 30_000, onLateError: console.error });
const remove = pipeline.use(timing, { priority: 100 });
pipeline.use(onlyText);

const passed = await pipeline.run({ message }); // true: atravessou; false: interrompida
// Com terminal: roda no centro da cebola, só se a mensagem atravessar.
await pipeline.run({ message }, async (ctx) => { /* comando e listeners */ });
remove(); // idempotente
```

- **Prioridade**: maior roda antes (mais por fora). Padrão `0`, aceita negativos. Empate segue
  a ordem de registro. Valor não finito lança `RangeError`.
- `run(ctx, terminal?)` resolve `true` se todos chamaram `next()` até o fim e `false` se algum
  interrompeu. O `terminal` roda quando o último middleware chama `next()`, e a volta espera por
  ele; o erro dele propaga pela cadeia como o de um middleware. O `Bot` passa ali o roteador e
  os listeners.
- Sem `timeoutMs`, o pipeline não tem prazo. Com ele, `close()` abandona os middlewares em
  andamento (`MiddlewareAbandonedError`) e desarma os timers; o `Bot` chama no fim do shutdown.
- A ordem é calculada em `use()`/remoção, não por mensagem. Uma mensagem em andamento usa a
  cadeia de quando começou: registrar ou remover no meio não a afeta.

## Middlewares oficiais

Todos são fábricas; registre com a prioridade que quiser. Ordem sugerida (de fora para dentro):

```ts
import { chatFilter, ignoreBots, ignoreSelf, rateLimit, sanitize } from '@zapforge/core';

pipeline.use(ignoreSelf(), { priority: 1000 });
pipeline.use(ignoreBots(), { priority: 990 });
pipeline.use(chatFilter({ block: ['123@g.us'] }), { priority: 900 });
pipeline.use(rateLimit({ max: 10, windowMs: 1000 }), { priority: 800 });
pipeline.use(sanitize(), { priority: 700 });
```

### `ignoreSelf()`

Barra mensagens com `message.fromMe` (enviadas pela própria sessão do bot).

### `ignoreBots()`

Barra mensagens com `message.sender.isBot` (outros bots no chat, no Discord e no Telegram), para
dois bots não entrarem em loop respondendo um ao outro. Sem `isBot`, o remetente passa.

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
