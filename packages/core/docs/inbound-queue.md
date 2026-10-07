# Fila de entrada por chat

`InboundQueue` serializa o processamento das mensagens de um mesmo chat e roda chats
distintos em paralelo, sem bloqueio global. É a porta do `JidQueue` do legacy, com limite de
backlog, métricas e shutdown gracioso.

Peça interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)): o app só a configura por
`createBot({ inbound: { maxPendingPerChat } })`. Os exemplos abaixo são para quem mexe no core.

```ts
import { InboundQueue } from '#queue/inbound.ts';

const queue = new InboundQueue({
  onError: (error, chatId) => logger.error({ err: error, chatId }, 'falha ao processar mensagem'),
  maxPendingPerChat: 100, // padrão
});

transport.onMessage((message) => {
  const result = queue.enqueue(message.chat.id, () => pipeline.handle(message));
  if (result !== 'queued') metrics.inc('inbound_dropped', { reason: result });
});
```

No `Bot`, cada evento `message` do transport vira uma tarefa no chat dele, a fila é configurada
por `createBot({ inbound })`, o erro de uma tarefa vai para o log com o `chatId` e o `stop()` a
fecha e drena antes do teardown dos plugins ([Bot](bot.md#fluxo-de-uma-mensagem)).

## Ordem e paralelismo

- Tarefas do mesmo `chatId` rodam uma de cada vez, na ordem de `enqueue`.
- Chats diferentes não esperam uns pelos outros.
- Num chat ocioso, a tarefa começa **na hora, de forma síncrona**, dentro do `enqueue`.
- Uma tarefa que chama `enqueue` no próprio chat agenda a nova para depois dela.
- A tarefa pode ser síncrona ou devolver uma promise; o chat só avança quando ela termina.
  Uma promise que nunca resolve trava aquele chat (e só ele): ponha timeout na própria tarefa
  se ela depende de I/O. No bot, a tarefa é o tratamento inteiro da mensagem, com comando e
  listeners: um handler lento segura o chat ([ADR 0042](../../../docs/adr/0042-handler-lento-segura-o-chat.md)).

## Erros

`enqueue` nunca lança nem rejeita. Erro de uma tarefa (síncrono ou rejeição) vai para o
`onError` obrigatório, é contado em `errors` e o chat segue para a próxima tarefa. Se o
próprio `onError` lançar, a fila continua e o erro vira exceção não capturada
(`AggregateError` com os dois erros), para não sumir em silêncio.

## Limite de backlog

`maxPendingPerChat` (padrão `100`) limita quantas tarefas **aguardam** por chat; a que está
rodando não conta. Ao exceder, a nova tarefa é rejeitada: `enqueue` devolve `'full'`, ela
nunca roda e entra em `dropped`. Descarta-se a mais nova porque as anteriores já foram
aceitas e a ordem do chat se mantém. `0` aceita só a tarefa em execução; `Infinity` desliga o
limite (comportamento do legacy). O limite isola um chat em rajada: os outros seguem aceitando.

| Retorno de `enqueue` | Significado |
| --- | --- |
| `'queued'` | Aceita: iniciada ou aguardando |
| `'full'` | Backlog do chat cheio; descartada |
| `'closed'` | Fila fechada (shutdown); descartada |

## Métricas

`stats()` devolve contadores mantidos incrementalmente (leitura O(1)):

| Campo | O que conta |
| --- | --- |
| `activeChats` | Chats com tarefa rodando |
| `pending` | Tarefas aguardando, somando todos os chats |
| `processed` | Tarefas concluídas (sucesso ou erro) |
| `dropped` | Tarefas rejeitadas (`'full'` ou `'closed'`) |
| `errors` | Tarefas que lançaram (subconjunto de `processed`) |

`pendingFor(chatId)` dá o backlog de um chat.

## Shutdown

- `close()` para de aceitar tarefas (novas devolvem `'closed'`) e resolve quando as já
  aceitas terminarem. É idempotente; `closed` diz se já foi chamado.
- `close({ drain: false })` descarta as tarefas que aguardam (contam em `dropped`) e resolve
  quando as que já rodam terminarem. Chamado durante uma drenagem, aborta-a: é o que o bot faz
  quando o gancho de parada da fila estoura o prazo.
- `onIdle()` resolve quando não há nada rodando nem aguardando, sem fechar a fila.

## Memória

Um chat só ocupa entrada no `Map` interno enquanto tem tarefa rodando; ao esvaziar, ela é
removida. Chats ociosos não custam nada.
