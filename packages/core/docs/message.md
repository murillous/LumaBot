# Modelo de mensagem

O core entrega aos plugins uma `Message` normalizada, independente do transport
([ADR 0009](../../../docs/adr/0009-modelo-de-mensagem-normalizado.md)). Os tipos estão em
`src/message/types.ts`; a construção, em `createMessage` e `createMedia`.

## Lendo mensagens (plugins)

`Message` é uma union discriminada por `type`. Estreite com `msg.is(...)` ou comparando `type`:

```ts
if (msg.is('image')) {
  msg.media.mimetype;            // `media` só existe nos tipos de mídia
  const buffer = await msg.media.download();
}

if (msg.type === 'voice') { /* PTT; `audio` é outro tipo */ }

msg.quoted;                      // Message | null — mesmo tipo, recursivo
if (msg.quoted?.is('sticker')) await msg.quoted.media.download();
```

- `text` é o texto ou a legenda (`null` se não houver); em `TextMessage` é sempre `string`. No
  bot, prefira o texto de trabalho `ctx.text`, que reflete os middlewares (ex.: truncado).
- `sender`/`mentions` são `Contact`: `id` (o ID nativo do transport), `name` e `phone` (ver
  abaixo).
- `mentions` (`Contact[]`) e as flags `isForwarded`, `isViewOnce`, `isEdited` estão em todos
  os tipos.
- `MessageOf<'image' | 'video'>` dá o membro da union para um ou mais tipos;
  `MediaMessageType` lista os tipos que carregam `media`.
- `is()` é propriedade própria da mensagem: sobrevive a `{ ...msg }`.
- `key` (`MessageKey`) é a chave para agir sobre a mensagem: `ctx.send.react(msg.key, '👍')`,
  `ctx.send.delete(msg.quoted.key)` ([ADR 0040](../../../docs/adr/0040-acoes-do-transport-no-plugin.md)).
  No contexto de comando ou listener, `c.react('👍')` já usa a chave da mensagem recebida.

## Mídia

`media.download()` e `media.stream()` são lazy: nada é baixado antes da primeira chamada.

- `download()` resolve um `Buffer` e o cacheia na mensagem: a segunda chamada (ou uma
  concorrente) não baixa de novo. O buffer é compartilhado entre os chamadores — trate-o como
  somente leitura.
- Falha não fica cacheada: chamar de novo tenta outra vez.
- `stream()` resolve um `ReadableStream<Uint8Array>` (Web Streams, nativo no Node 24). Se o
  buffer já foi baixado (ou está baixando), o stream sai dele; senão usa o stream nativo do
  transport, sem carregar o arquivo inteiro em memória. Streams não são cacheados: cada
  chamada abre um novo. Para APIs do Node que pedem `Readable`, use `Readable.fromWeb(stream)`.

## `Contact.phone`

`phone` é o telefone só com dígitos e DDI (`'5511999999999'`), ou `null` se o transport não
souber. Ele é separado de `id` porque o ID nativo nem sempre carrega o número — no WhatsApp,
`sender.id` pode ser um LID — e só o transport sabe resolvê-lo. É por `phone` que o roteador
reconhece os `owners` ([Comandos](commands.md#role)); `null` nunca é owner.

O campo é obrigatório no tipo: o transport precisa decidir, e `null` é uma resposta explícita.

## Construindo mensagens (transports)

O transport mapeia o formato nativo para `MessageInit` e chama `createMessage`:

```ts
import { createMessage } from '@zapforge/core/adapter';

const quoted = createMessage({ /* ... */ });   // citada: construída do mesmo jeito

const msg = createMessage({
  type: 'image',
  id: raw.key.id,
  chat: { id: jid, isGroup: jid.endsWith('@g.us') },
  sender: { id: participant, name: pushName ?? null, phone: phoneOf(participant) }, // só dígitos ou null
  text: caption ?? null,
  timestamp: Number(raw.messageTimestamp) * 1000,
  fromMe: raw.key.fromMe,
  quoted,
  mentions,
  media: {
    mimetype: image.mimetype,
    size: Number(image.fileLength) || null,
    download: () => downloadBuffer(raw),                             // obrigatório
    stream: async () => Readable.toWeb(await downloadStream(raw)),  // opcional
  },
});
```

- `phone` vai em todo `Contact` (remetente, menções, participantes): só dígitos com DDI, sem
  `+`, ou `null`. O `createMessage` o propaga como veio.
- O retorno é tipado pelo `type` informado (`ImageMessage` acima), e cada tipo exige os seus
  campos (`media`, `location`, `poll`...).
- Padrões: `quoted: null`, `mentions: []`, flags `false` (inclusive para `undefined`
  explícito). `fromMe` é obrigatório: esquecê-lo faria o bot responder a si mesmo.
- `key` não entra: `createMessage` a deriva de `chat`, `id`, `fromMe` e `sender` (o autor só em
  grupo), com a mesma regra de `messageKey`.
- `media` recebe um `MediaSource` (o loader nativo); `createMessage` o embrulha com
  `createMedia`, que aplica laziness e cache. `createMedia` também sai de
  `@zapforge/core/adapter` para quem precisar de uma `Media` avulsa.

## Testes de tipo

O narrowing é garantido por `src/message/types.test-d.ts` (`expectTypeOf`). Esses testes não
rodam no `pnpm test`: quem os verifica é o `pnpm typecheck`.
