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
- `sender`/`mentions` são `Contact`: `id` (o ID nativo do transport), `name` e `phone`, mais
  os opcionais `username`, `isBot` e `claims` (ver abaixo).
- `mentions` (`Contact[]`) e as flags `isForwarded`, `isViewOnce`, `isEdited` estão em todos
  os tipos.
- `location` traz `latitude`, `longitude`, `name` e, quando a plataforma informa, `address`
  (o `venue` do Telegram, por exemplo).
- `MessageOf<'image' | 'video'>` dá o membro da union para um ou mais tipos;
  `MediaMessageType` lista os tipos que carregam `media`.
- `is()` é propriedade própria da mensagem: sobrevive a `{ ...msg }`.
- `key` (`MessageKey`) é a chave para agir sobre a mensagem: `ctx.send.react(msg.key, '👍')`,
  `ctx.send.delete(msg.quoted.key)` ([ADR 0040](../../../docs/adr/0040-acoes-do-transport-no-plugin.md)).
  No contexto de comando ou listener, `c.react('👍')` já usa a chave da mensagem recebida.

### Tipos novos e `unknown`

O que a plataforma tem sem equivalente na lista chega como `unknown`: o dado do Telegram, o jogo,
a fatura, o story, a mensagem do Discord só com embed ou componentes. Um plugin específico de
plataforma lê o resto pelo objeto bruto ([unsafe](unsafe.md)). O que se trata do mesmo jeito
chega pelo tipo comum
([ADR 0069](../../../docs/adr/0069-unioes-de-tipo-antes-do-1-0.md)):

| Na plataforma | Chega como |
| --- | --- |
| GIF (`animation` do Telegram, `gifPlayback` do WhatsApp) | `video`; um GIF enviado como imagem é `image` com `image/gif` |
| Recado de vídeo redondo (`video_note`, `ptv`) | `video` |
| Local com endereço (`venue` do Telegram) | `location`, com `address` |

A lista de tipos pode crescer numa minor: o que hoje chega como `unknown` pode ganhar tipo
próprio. Trate `unknown` e use `default` no `switch`, sem o `never` exaustivo, que deixaria de
compilar na atualização:

```ts
switch (msg.type) {
  case 'image':
    return converter(msg.media);
  case 'video':
    return converterVideo(msg.media);
  default:
    return; // `unknown` e qualquer tipo futuro
}
```

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

## Vários anexos

`attachments` traz todas as mídias da mensagem, na ordem da plataforma
([ADR 0065](../../../docs/adr/0065-varios-anexos-e-albuns.md)). Uma mensagem do Discord com
imagem e PDF, um álbum do Telegram ou os arquivos de uma mensagem do web chegam numa mensagem só.

```ts
for (const anexo of ctx.message.attachments) {
  anexo.mimetype;           // 'image/png', 'application/pdf'...
  anexo.fileName;           // string | undefined: nome do arquivo, quando a plataforma informa
  const buffer = await anexo.download();
}
```

- Sem mídia, `attachments` é vazio. Nos tipos de mídia, `attachments[0]` é o próprio `media`, o
  mesmo objeto com o mesmo cache.
- O `type` é o do primeiro anexo: imagem seguida de PDF é `image`. Por isso o `accepts`, o
  `ctx.media` e o `message:image` tratam a mensagem como antes, pela primeira mídia. O comando que
  quer os outros lê `ctx.message.attachments`.
- Cada anexo tem o seu `download()` e `stream()`, lazy e com cache, como o `media`.

## `Contact.phone`

`phone` é o telefone só com dígitos e DDI (`'5511999999999'`), ou `null` se a plataforma não tem
telefone (Discord, web) ou o transport não souber resolvê-lo. Ele é separado de `id` porque o ID
nativo nem sempre carrega o número (no WhatsApp, por exemplo, o `id` pode ser um identificador sem
ele), e só o transport sabe resolvê-lo. É por `phone` que o roteador reconhece os `owners`
telefone ([Comandos](commands.md#role)); com `null`, só um owner `{ id }` reconhece o remetente.

O campo é obrigatório no tipo: o transport precisa decidir, e `null` é uma resposta explícita.

## `username`, `isBot` e `claims`

Campos opcionais que o transport preenche quando a plataforma tem a informação
([ADR 0057](../../../docs/adr/0057-contact-multiplataforma.md)). Ausente quer dizer que o
transport não sabe:

| Campo | Tipo | O que é |
| --- | --- | --- |
| `username` | `string` | `@usuario` sem o `@` (Telegram, Discord) |
| `isBot` | `boolean` | Conta automatizada. Ausente conta como pessoa, e o `ignoreBots` barra `true` ([Bot](bot.md#middlewares)) |
| `claims` | `Readonly<Record<string, JsonValue>>` | Atributos verificados pelo transport, como os claims do JWT do web |

```ts
const papel = ctx.message.sender.claims?.['papel']; // JsonValue | undefined
```

Os `claims` só aparecem no contato que fez a ação: o remetente, quem reagiu, quem apagou. Nos
contatos de `mentions` e de participantes de grupo, o transport não os tem. São somente leitura
e já vêm verificados, então o plugin pode confiar neles. Para consultar o sistema de origem, o
plugin usa a própria credencial de serviço: o token do usuário não chega a ele.

## `Chat`

`chat.id` é o ID opaco do transport, e é para ele que vai a resposta. O plugin não o decompõe.
`isGroup` é verdadeiro em todo chat que não é conversa privada. Os campos opcionais abaixo
mostram a estrutura quando a plataforma tem a informação
([ADR 0058](../../../docs/adr/0058-chat-multiplataforma.md)). Ausente quer dizer que o
transport não sabe:

| Campo | Tipo | O que é |
| --- | --- | --- |
| `kind` | `'dm' \| 'group' \| 'channel' \| 'thread'` | Tipo do chat (tabela abaixo). Ausente: vale só o `isGroup` |
| `parentId` | `string` | Espaço a que o chat pertence: o servidor do Discord ou o supergrupo do Telegram |
| `title` | `string` | Nome do chat: assunto do grupo, nome do canal ou do tópico |
| `tenantId` | `string` | Cliente do dono a que a conversa pertence, verificado pelo transport (claim do JWT no web). Põe o `ctx.storage` no escopo dele ([storage](storage.md#tenants)) |

| `kind` | WhatsApp | Telegram | Discord | Web |
| --- | --- | --- | --- | --- |
| `dm` | conversa privada | privado | DM | conversa |
| `group` | grupo | grupo, supergrupo | DM em grupo | sala |
| `channel` | — | canal de transmissão | canal de servidor | — |
| `thread` | — | tópico de fórum | thread, post de fórum | — |

```ts
const { kind, parentId } = ctx.message.chat;
if (kind === 'thread' && parentId !== undefined) {
  // um tópico ou thread do espaço `parentId`; `reply` responde dentro dele
}
```

Um tópico do Telegram não tem ID próprio: o transport compõe o `chat.id` do chat e do tópico, e
`ctx.send.send(chat.id, …)` cai no tópico, não no "General". Uma thread do Discord já tem ID
próprio. Nos dois casos, `parentId` é o espaço, não o canal-pai: é o que o `chatFilter` e o
admin leem.

## Construindo mensagens (transports)

O transport mapeia o formato nativo para `MessageInit` e chama `createMessage`. No exemplo, uma
foto do Telegram (a versão do WhatsApp está no `@zapforge/transport-baileys`):

```ts
import { createMessage } from '@zapforge/core/adapter';

const quoted = createMessage({ /* ... */ });   // citada: construída do mesmo jeito

const photo = raw.photo.at(-1); // a maior resolução
const msg = createMessage({
  type: 'image',
  id: String(raw.message_id),
  chat: {
    id: String(raw.chat.id),
    isGroup: raw.chat.type !== 'private',
    kind: raw.chat.type === 'private' ? 'dm' : 'group',
    title: raw.chat.title,
  },
  sender: {
    id: String(raw.from.id),
    name: raw.from.first_name,
    phone: null,                   // o Telegram não informa o telefone de quem escreve
    username: raw.from.username,
    isBot: raw.from.is_bot,
  },
  text: raw.caption ?? null,
  timestamp: raw.date * 1000,
  fromMe: raw.from.id === botId,
  quoted,
  mentions,
  media: {
    mimetype: 'image/jpeg',
    size: photo.file_size ?? null,
    download: () => downloadFile(photo.file_id),                             // obrigatório
    stream: async () => Readable.toWeb(await downloadStream(photo.file_id)), // opcional
  },
});
```

- `phone` vai em todo `Contact` (remetente, menções, participantes): só dígitos com DDI, sem
  `+`, ou `null`. O `createMessage` o propaga como veio.
- `kind`, `parentId` e `title` do `chat` entram só quando a plataforma informa; `isGroup` vai
  sempre, e fica `false` só em `kind: 'dm'`.
- `username`, `isBot` e `claims` entram só quando a plataforma informa. `claims` é só para o que
  o transport verificou (assinatura do JWT, por exemplo), nunca para o que o cliente declarou.
- O retorno é tipado pelo `type` informado (`ImageMessage` acima), e cada tipo exige os seus
  campos (`media`, `location`, `poll`...).
- O que a plataforma não tem como tipo vai como `unknown`, e o objeto bruto fica no
  `Transport.raw` ([Transport](transport.md)). GIF e recado de vídeo vão como `video`; `venue`,
  como `location` com `address` (tabela em [Tipos novos e `unknown`](#tipos-novos-e-unknown)).
- `isViewOnce` e `isForwarded` são `false` onde a plataforma não tem o conceito.
- Padrões: `quoted: null`, `mentions: []`, flags `false` (inclusive para `undefined`
  explícito). `fromMe` é obrigatório: esquecê-lo faria o bot responder a si mesmo.
- `key` não entra: `createMessage` a deriva de `chat`, `id`, `fromMe` e `sender` (o autor só em
  grupo), com a mesma regra de `messageKey`.
- `media` recebe um `MediaSource` (o loader nativo); `createMessage` o embrulha com
  `createMedia`, que aplica laziness e cache. `createMedia` também sai de
  `@zapforge/core/adapter` para quem precisar de uma `Media` avulsa. O `fileName` do
  `MediaSource` é opcional e vai para o `Media`.
- Com mais de uma mídia, `attachments` recebe a lista de `MediaSource`, começando pela própria
  `media`, e o `type` é o do primeiro. Sem a lista, `attachments` sai `[media]`, ou vazio nos tipos
  sem mídia. O `createMessage` lança `TypeError` se a lista não começar pela `media` ou se vier
  anexo num tipo sem mídia.

```ts
const [first, ...rest] = raw.attachments.map(toMediaSource); // ex.: anexos do Discord
const msg = createMessage({
  ...base,
  type: typeOf(first),       // 'image', 'document'...
  text: raw.content || null,
  media: first,
  attachments: [first, ...rest],
  // `fileName` também, se o primeiro for documento
});
```

## Testes de tipo

O narrowing é garantido por `src/message/types.test-d.ts` (`expectTypeOf`). Esses testes não
rodam no `pnpm test`: quem os verifica é o `pnpm typecheck`.
