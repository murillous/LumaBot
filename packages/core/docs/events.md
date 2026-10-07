# Eventos

O barramento é o 3º estágio do pipeline ([ADR 0012](../../../docs/adr/0012-pipeline-de-3-estagios.md)):
a mensagem que nenhum comando consumiu chega aos listeners, que rodam em paralelo, cada um
isolado por try/catch + timeout ([ADR 0005](../../../docs/adr/0005-plugins-no-mesmo-processo.md)).
Os demais eventos do transport (grupos, reações, conexão) passam só por aqui.

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

### Eventos

| Evento | Payload |
| --- | --- |
| `message` | `Message` (qualquer tipo) |
| `message:<type>` | a mesma mensagem, estreitada (`message:image` → `ImageMessage`) |
| `message.edited` | nova versão da `Message`, com `isEdited: true` |
| `message.deleted` | `{ chat, messageId, deletedBy }` |
| `reaction` | `{ chat, messageId, sender, emoji }` (`emoji: null` = removida) |
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

- O timeout não cancela o listener (não há como); ele segue rodando, mas já foi reportado. Se
  rejeitar depois do prazo, o erro vai só para o `onError`.
- Falha num listener de `plugin.error` vai só para o `onError`: virar outro `plugin.error`
  geraria um loop.

## Montar o bus (kernel)

O `Bot` monta um único bus e entrega `bus.forPlugin(nome)` a cada plugin:

```ts
import { createEventBus } from '@zapforge/core';

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
- `message:<type>` não se emite diretamente (o tipo de `emit` barra): emita `message` e o bus
  deriva o resto.
- `extras` são campos que quem emite acrescenta ao contexto (ex.: `reply` para mensagens),
  copiados para o contexto compartilhado. São opcionais enquanto o `ListenerContext` do evento
  não declarar nenhum além de `event`, `payload`, `claimed` e `claim`.
- A ordem é calculada no `on()`/remoção (e, para `message`, cacheada por tipo), não por
  emissão. Assinar ou remover durante uma emissão não afeta a rodada em andamento.
