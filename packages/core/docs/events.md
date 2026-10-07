# Eventos

O barramento é o 3º estágio do pipeline ([ADR 0012](../../../docs/adr/0012-pipeline-de-3-estagios.md)):
a mensagem que nenhum comando consumiu chega aos listeners, que rodam em paralelo, cada um
isolado por try/catch + timeout ([ADR 0005](../../../docs/adr/0005-plugins-no-mesmo-processo.md)).
Os demais eventos do transport (grupos, reações, conexão) passam só por aqui, depois do
`chatFilter` e do `ignoreSelf` do bot ([Bot](bot.md#eventos-que-não-são-mensagem)).

## Assinar (plugin)

O plugin recebe um `EventSubscriber` em `ctx.events`:

```ts
setup(ctx) {
  ctx.events.on('message:image', async (e) => {
    await e.payload.media.download(); // payload já estreitado para ImageMessage
  });

  // opções no meio (como no plano) ou no fim
  ctx.events.on('message', { quoted: 'audio' }, (e) => { /* respondeu a um áudio */ });
  ctx.events.on('group.joined', (e) => { /* e.payload.groupId */ }, { priority: 5 });
}
```

`on()` devolve a função que desfaz a assinatura (idempotente). No teardown o kernel remove todas
as do plugin, então não é preciso guardá-la só para isso.

### Contexto dos eventos de mensagem

Em `message`, `message:<tipo>` e `message.edited`, o contexto traz também
(`MessageListenerFields`):

| Campo | Conteúdo |
| --- | --- |
| `message` | a mesma mensagem de `payload` |
| `text` | o texto de trabalho, depois dos middlewares (ex.: truncado pelo `sanitize`) |
| `reply` | responde no chat, citando a mensagem, pela fila de saída |
| `log` | logger com `plugin` e `chatId` |

```ts
ctx.events.on('message', async (e) => {
  if (!e.text?.includes('bom dia')) return;
  e.log.info('cumprimento');
  await e.reply('Bom dia! ☀️');
});
```

O tipo é condicional: `ListenerContext<'reaction'>` não tem esses campos.

### `signal` (todo evento)

Todo listener recebe `e.signal: AbortSignal`, que aborta quando **o prazo dele** estoura
(`reason` = `ListenerTimeoutError`, com `plugin`, `event` e `timeoutMs`). É por listener, não por emissão: o contexto da emissão é
compartilhado (`claim()`), mas cada listener recebe uma visão própria com o próprio prazo, e um
listener lento expirar não afeta o `signal` nem o `reply` de outro do mesmo evento
([ADR 0033](../../../docs/adr/0033-cancelamento-cooperativo.md)). O descarte do plugin (teardown,
reload) também aborta o `signal` dos listeners dele ainda em andamento, com o motivo do descarte
(`forPlugin(plugin, { lifetime })` recebe o `Deadline` de vida do plugin).

```ts
ctx.events.on('message', async (e) => {
  const res = await fetch(url, { signal: e.signal });
  await e.reply(await res.text()); // depois do prazo: rejeita com ContextExpiredError
});
```

No bot, o `reply` de um listener expirado rejeita com `ContextExpiredError` e uma linha `warn`
(plugin e evento), sem chegar ao transport. Código síncrono travado bloqueia o processo inteiro;
nenhum prazo resolve isso.

### Eventos

| Evento | Payload |
| --- | --- |
| `message` | `Message` (qualquer tipo) |
| `message:<type>` | a mesma mensagem, estreitada (`message:image` → `ImageMessage`) |
| `message.edited` | nova versão da `Message`, com `isEdited: true` |
| `message.deleted` | `{ chat, messageId, deletedBy, fromMe }` |
| `reaction` | `{ chat, messageId, sender, emoji, fromMe }` (`emoji: null` = removida) |
| `group.joined` / `group.left` | `{ groupId }` |
| `group.participants` | `{ groupId, action, participants, actor }` |
| `group.updated` | `{ groupId }` + só os campos alterados |
| `connection.status` / `connection.qr` | `ConnectionStatus` / `{ qr }` |
| `plugin.error` | `PluginErrorEvent`: `{ plugin, phase, event, error, timedOut }` |

### Opções

| Opção | Padrão | Efeito |
| --- | --- | --- |
| `priority` | `0` | Maior começa antes e vê o `claim()` primeiro. Empate: ordem de registro. Aceita negativos. |
| `timeoutMs` | o do bus (30 s) | Prazo do listener antes de virar `plugin.error` com `timedOut: true`. |
| `quoted` | — | Só em eventos de mensagem: um tipo ou lista de tipos que a mensagem precisa citar. |

Prioridade não finita ou prazo que não seja um número finito > 0 lançam `RangeError` no `on()`.

## Paralelo e `claim()`

Na emissão, o bus **inicia** todos os listeners em ordem de prioridade decrescente, na mesma
volta síncrona, sem esperar um terminar para chamar o próximo. `message` alcança também os
listeners de `message:<type>` do tipo da mensagem, numa única ordem e com o mesmo `claim()`.

Todos os listeners de uma emissão compartilham o mesmo contexto. Para "responder só se ninguém
mais respondeu", **leia e reivindique antes do primeiro `await`**:

```ts
ctx.events.on('message', { priority: -10 }, async (e) => {
  if (e.claimed) return; // alguém de prioridade maior já respondeu
  e.claim();             // antes do await: os de prioridade menor já veem
  await responder(e.payload);
});
```

Um `claim()` depois de um `await` vale (e aparece no resultado do `emit`), mas os de prioridade
menor provavelmente já começaram sem vê-lo. Cada emissão tem o próprio `claim()`.

## Isolamento e `plugin.error`

Exceção síncrona, rejeição ou timeout de um listener não afetam os demais: o bus monta um
`PluginErrorEvent` (`phase: 'listener'`, nome do plugin, evento, `timedOut`), entrega ao `onError`
do bus e emite `plugin.error` para quem quiser assinar (ex.: dashboard).

- O timeout não cancela o listener (não há como); ele segue rodando, mas já foi reportado, e o
  `signal` dele aborta. Se rejeitar depois do prazo, o erro vai só para o `onError`.
- Falha num listener de `plugin.error` vai só para o `onError`: virar outro `plugin.error`
  geraria um loop.

## O bus por dentro

O `Bot` monta um único bus e entrega a cada plugin uma assinatura em nome dele. As mensagens que
nenhum comando consumiu, as edições e os demais eventos do transport chegam por `emit`; falha de
listener vai para o log do bot. Por dentro (interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md))):

```ts
import { createEventBus } from '#events/bus.ts';

const bus = createEventBus({
  onError: (e) => log.error({ plugin: e.plugin, event: e.event, err: e.error }, 'listener falhou'),
  listenerTimeoutMs: 30_000, // padrão
});

const events = bus.forPlugin('sticker'); // vai em PluginContext.events
bus.removePlugin('sticker');             // teardown/reload: remove tudo do plugin

const result = await bus.emit('message', message, extras);
// { listeners: 2, claimed: true, failed: 0 }
```

- `onError` é obrigatório e é o destino garantido de toda falha (inclusive as que não viram
  evento). Não deve lançar.
- `emit` nunca rejeita: resolve quando todos os listeners assentam ou estouram o prazo.
- Cada listener recebe uma visão própria do contexto da emissão (`Object.create(ctx)`), com o
  próprio prazo e `signal`. `forPlugin(plugin, { view })` troca essa visão por evento assinado —
  o `Bot` a usa para pôr `message`/`text`/`reply`/`log` do plugin nos eventos de mensagem; a
  visão precisa herdar do contexto recebido.
- `message:<type>` não se emite diretamente (o tipo de `emit` barra): emita `message` e o bus
  deriva o resto.
- `extras` são campos que quem emite acrescenta ao contexto, copiados para o contexto
  compartilhado. O barramento não os confere: o tipo os aceita opcionais em todo evento. Nos
  eventos de mensagem, quem garante `message`/`text`/`reply`/`log` é o `Bot`, que monta uma visão
  por listener (o `log` leva o nome do plugin, então não cabe no contexto compartilhado). Quem
  usa o barramento solto e emite mensagem sem extras entrega listeners sem esses campos.
- A ordem é calculada no `on()`/remoção (e, para `message`, cacheada por tipo), não por
  emissão. Assinar ou remover durante uma emissão não afeta a rodada em andamento.
