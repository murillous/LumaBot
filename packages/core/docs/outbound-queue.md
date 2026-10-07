# Fila de saída

`OutboundQueue` é por onde todo envio do bot passa ([ADR 0019](../../../docs/adr/0019-fila-de-saida-anti-ban.md)):
intervalo mínimo global e por chat, prioridade (comando > broadcast), retry com backoff e
humanização opcional. Ela implementa `Sender`, o mesmo contrato de `ctx.send`, e
`createReply` monta o `ctx.reply` em cima dela. O plugin nunca vê a fila.

Peça interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)): o app só a configura por `createBot({ outbound })`
(as opções abaixo, sem `transport`); o plugin envia por `ctx.send`/`ctx.reply` e trata
`OutboundQueueError` e `UnsupportedError`, de `@zapforge/core`. Os exemplos são para quem mexe
no core.

```ts
import { OutboundQueue } from '#outbound/queue.ts';
import { createReply } from '#outbound/reply.ts';

const queue = new OutboundQueue({
  transport,
  globalIntervalMs: 300, // padrão
  chatIntervalMs: 1000, // padrão
  maxPending: 1000, // padrão, por prioridade
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30_000 }, // padrões
  humanize: false, // padrão
});

await queue.send('123@g.us', { type: 'text', text: 'aviso' }, { priority: 'low' });

const reply = createReply(queue, message);
await reply('pong'); // cita `message`, prioridade high
await reply.sticker(buffer);
```

## Taxa

- **Global**: dois envios quaisquer começam com pelo menos `globalIntervalMs` de distância.
- **Por chat**: dois envios ao mesmo chat começam com pelo menos `chatIntervalMs` de distância,
  e o chat tem um envio por vez.
- Um chat esperando o próprio intervalo não segura os outros: eles só esperam o global.
- Na fila ociosa, o primeiro envio sai na hora, de forma síncrona, dentro do `send`.

Os padrões são conservadores (≈3 msg/s no total, 1 msg/s por chat). A latência sob carga sobe
por design: é o preço de não tomar ban.

## Prioridade e ordem

`priority` é `'high'`, `'normal'` (padrão) ou `'low'`. Quando o intervalo global libera, sai o
chat pronto com a mensagem de maior prioridade; entre chats de mesma prioridade, o que ficou
pronto primeiro.

- No mesmo chat e mesma prioridade a ordem de chegada é mantida.
- No mesmo chat, uma `high` passa à frente de `normal`/`low` que ainda aguardam.
- Uma mensagem em espera de re-tentativa sai antes das demais do chat, qualquer que seja a
  prioridade delas: o chat espera por ela, para não embaralhar.

## Backlog

`maxPending` (padrão `1000`) limita quantas mensagens **aguardam em cada prioridade**, somando os
chats; as em andamento não contam e as em espera de re-tentativa contam na prioridade delas. Ao
exceder, o novo envio rejeita com `OutboundQueueError` `'full'` e as já aceitas seguem.

O limite é por prioridade de propósito: um broadcast `low` que encheu a fila não recusa uma
resposta `high` a comando. No pior caso a fila guarda `3 × maxPending` mensagens.

## Erros e retry

`send` resolve com a `MessageKey` ou rejeita com o erro final; nunca fica sem destino.

| Situação | Resultado |
| --- | --- |
| Transport sem a capability (`assertCanSend`) | Rejeita na hora com `UnsupportedError`, sem tentar |
| `priority` inválida | Rejeita na hora com `TypeError` |
| Backlog da prioridade cheio (`maxPending`) | Rejeita com `OutboundQueueError`, `reason: 'full'` |
| Fila fechada | Rejeita com `OutboundQueueError`, `reason: 'closed'` |
| Transport falhou | Re-tenta se transitória; senão rejeita com o erro dele |

A espera antes da re-tentativa `n` é `min(maxDelayMs, baseDelayMs × 2^(n-1))`, com jitter: metade
fixa e metade proporcional a `random()` (injetável; padrão `Math.random`). `maxAttempts` conta a
primeira tentativa; `1` desliga o retry.

Por padrão toda falha é transitória, exceto `UnsupportedError` e erros com `retryable: false`.
**Transports**: marquem assim as falhas permanentes (destino inexistente, mídia recusada), para a
fila não insistir. Para outra regra, passe `retry.isRetryable`; se ele lançar, o envio rejeita
com um `AggregateError` com os dois erros.

## Humanização

Com `humanize: true` (ou um objeto com `msPerChar`, `minMs`, `maxMs`; padrões 50, 500 e 3000) e
um transport com a capability `presence`:

- texto: presença `composing` por `tamanho × msPerChar`, limitado a `[minMs, maxMs]`;
- voz: `recording` por `maxMs`;
- outros tipos: sem presença.

A espera conta dentro do envio: o chat fica ocupado, os outros seguem. O intervalo global espaça
o início de cada envio (a presença), então com tempos de digitação diferentes duas mensagens
podem chegar mais próximas que `globalIntervalMs`. Sem a capability, a
opção é ignorada. Uma falha de presença não impede o envio, que sai na hora; ela vai para
`onPresenceError(error, chatId)`, se houver, ou é descartada (presença é cosmética).

## Métricas

`stats()` lê contadores mantidos incrementalmente (O(1)):

| Campo | O que conta |
| --- | --- |
| `pending.high/normal/low` | Mensagens aguardando, inclusive em espera de re-tentativa |
| `inFlight` | Envios em andamento (presença + transport) |
| `activeChats` | Chats com mensagem aguardando ou em andamento |
| `sent` | Envios concluídos |
| `failed` | Envios que rejeitaram com o erro do transport |
| `retries` | Re-tentativas agendadas |
| `dropped` | Recusados (cheia/fechada) ou descartados no `close({ drain: false })` |

## Fechamento

- `close()` para de aceitar envios e resolve quando tudo o que foi aceito sair (com retries).
- `close({ drain: false })` rejeita o que aguarda com `OutboundQueueError` `'closed'`, cancela
  re-tentativas e só espera os envios já em andamento. Pode ser chamado durante um `close()`
  para abortar a drenagem.
- `onIdle()` resolve quando não há nada aguardando nem em andamento, sem fechar.

O `Bot` cria a fila com as opções de `createBot({ outbound })`, entrega `ctx.send` aos plugins e
fecha a fila num gancho de parada ([Bot](bot.md#shutdown-gracioso-stop)). Para montar à mão, como
gancho de parada, drenando até o prazo e descartando o resto se ele estourar:

```ts
bot.onStop(
  (signal) => {
    signal.addEventListener('abort', () => void queue.close({ drain: false }), { once: true });
    return queue.close();
  },
  { name: 'fila-de-saida' },
);
```

Um `transport.send` que nunca resolve segura o fechamento: o prazo do gancho é a rede de
segurança.

## `ctx.reply`

`createReply(sender, message, { quote })` devolve um `Reply`: chamado com texto, envia texto; os
atalhos `text`, `image`, `video`, `audio`, `voice`, `sticker`, `document` e `poll` cobrem cada
tipo de `OutgoingContent`. Todos enviam no chat de `message`, citando-a, com prioridade `high`
(sobrescrevível por `priority`) e aceitam `mentions`.

Quem monta o contexto passa `quote: false` quando o transport não tem a capability `quoted`
(`hasCapability(transport, 'quoted')`); sem isso toda resposta rejeitaria com
`UnsupportedError`.

## Memória e timers

- Um chat só ocupa estado enquanto tem mensagem aguardando ou em andamento; o fim do intervalo
  por chat é lembrado num mapa limpo a cada envio, então chats ociosos não acumulam.
- Timers só existem com trabalho pendente (intervalo, backoff, presença). Ociosa, a fila não
  segura o processo. Com trabalho pendente segura, de propósito: mensagem aceita não se perde
  em silêncio.
