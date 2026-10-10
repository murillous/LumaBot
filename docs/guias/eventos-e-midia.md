# Eventos e mídia

Comando é o que a pessoa pede. Evento é o que acontece: uma mensagem que não é comando, uma reação,
alguém entrando no grupo. Este guia mostra como reagir a eventos e como ler e enviar mídia. O
detalhe está em [Eventos](../../packages/core/docs/events.md) e
[Modelo de mensagem](../../packages/core/docs/message.md).

## Reagir a um evento

Listener fixo vai no `on` do manifesto, com o contexto do plugin no 2º argumento:

```ts
import { definePlugin } from '@zapforge/core';

export const boasVindas = definePlugin({
  name: 'boas-vindas',
  version: '0.1.0',
  engine: '<1.0.0',
  requires: ['send.text'],
  on: {
    'group.participants': async (e, { send }) => {
      if (e.payload.action !== 'add') return;
      await send.send(e.payload.chat.id, 'Bem-vindo(a) ao grupo!');
    },
  },
});
```

Fora do `on` do manifesto não há `send.text` implícito: declare em `requires` o que o plugin usa
([Capabilities](capabilities.md)).

Os eventos mais usados:

| Evento | Quando | Payload |
| --- | --- | --- |
| `message` | Mensagem que nenhum comando consumiu | `Message` |
| `message:<tipo>` | O mesmo, filtrado por tipo (`message:image`, `message:voice`...) | A mensagem já estreitada |
| `message.edited` | Mensagem editada | A versão nova |
| `reaction` | Alguém reagiu (`emoji: null` = tirou a reação) | `{ chat, messageId, sender, emoji, fromMe }` |
| `poll.vote` | Voto numa enquete; `options` traz a escolha inteira | `{ chat, messageId, sender, options, fromMe }` |
| `group.joined` / `group.left` | O bot entrou ou saiu de um grupo | `{ chat }` |
| `group.participants` | Entrou, saiu, virou admin | `{ chat, action, participants, actor }` |
| `command` | Um comando rodou (só observação, sem `reply`) | `{ plugin, name, invokedAs, status, message }` |
| `plugin.error` | Um handler de algum plugin falhou | `{ plugin, phase, event, error, timedOut }` |

A lista completa está em [Eventos](../../packages/core/docs/events.md#eventos).

## Mensagens

Nos eventos de mensagem, o contexto traz `message`, `text`, `reply`, `react`, `expectReply` e
`log`. Use `e.text` (o texto depois dos middlewares do bot) em vez de `e.message.text`:

```ts
on: {
  message: async (e) => {
    if (!e.text?.toLowerCase().includes('bom dia')) return;
    await e.reply('Bom dia! ☀️');
  },
},
```

Mensagem que roda um comando não chega a `message`. Para ver as duas, assine também `command`.

### Vários listeners, filtros e prioridade

Para filtrar por citação, dar prioridade ou ter dois listeners do mesmo evento, assine no `setup`
com `ctx.events.on`:

```ts
setup(ctx) {
  // Só mensagens que respondem a um áudio
  ctx.events.on('message', { quoted: 'audio' }, (e) => e.reply('Ainda não sei ouvir áudio.'));

  // Responde só se nenhum listener de prioridade maior já respondeu
  ctx.events.on('message', { priority: -10 }, async (e) => {
    if (e.claimed) return;
    e.claim(); // antes do primeiro await, para os seguintes já verem
    await e.reply('Não entendi. Digite !ajuda.');
  });
}
```

Os listeners de um evento rodam em paralelo, cada um isolado: um que lança não afeta os outros e
vira `plugin.error`. No teardown, o kernel remove todos os do plugin.

## Trabalho longo

O bot só passa à próxima mensagem do chat quando os listeners da atual terminam. Um listener que
espera uma IA por 15 segundos segura o chat por 15 segundos, inclusive os comandos. Se a ordem
das respostas não importa, reivindique e solte o trabalho:

```ts
ctx.events.on('message', (e) => {
  if (e.claimed || !e.text?.startsWith('@bot')) return;
  e.claim();
  void (async () => {
    const resposta = await perguntarIa(e.text, { signal: AbortSignal.timeout(60_000) });
    await e.reply(resposta);
  })().catch((err: unknown) => e.log.warn('resposta falhou', { err }));
});
```

O trabalho solto sai do prazo do bot: ponha o próprio timeout e dê destino ao erro. Mais em
[Trabalho longo: solte o chat](../../packages/core/docs/events.md#trabalho-longo-solte-o-chat).

## Ler mídia

`message.type` diz o tipo. Nos tipos de mídia, `message.media` baixa o arquivo só quando você
pede:

```ts
on: {
  'message:image': async (e) => {
    const buffer = await e.payload.media.download(); // payload já é ImageMessage
    await e.reply(`Imagem de ${buffer.length} bytes (${e.payload.media.mimetype})`);
  },
},
```

- **`download()`** devolve um `Buffer`, guardado na mensagem: a segunda chamada não baixa de
  novo. Trate o buffer como somente leitura.
- **`stream()`** devolve um `ReadableStream`, sem carregar o arquivo inteiro em memória. Para
  APIs do Node que pedem `Readable`, use `Readable.fromWeb(stream)`.
- **A citada** está em `message.quoted`. Estreite com `is()`:
  `if (e.message.quoted?.is('image')) await e.message.quoted.media.download()`.
- **Vários anexos** (uma mensagem do Discord com imagem e PDF, um álbum do Telegram) estão em
  `message.attachments`. O `type` e o `media` são os do primeiro.
- **Tipos novos** chegam como `unknown`. Num `switch` sobre `type`, tenha um `default`: a lista de
  tipos pode crescer numa minor.

Num comando, o `accepts` já resolve a mídia da mensagem ou da citada em `c.media`
([Comandos](comandos.md#exigir-mídia-accepts)).

## Enviar mídia

O `reply` e o `send.send` mandam qualquer tipo. A mídia é um `Buffer` ou `{ url }`:

```ts
await e.reply.image(buffer, { caption: 'pronto' });
await e.reply.video({ url: 'https://exemplo.com/video.mp4' });
await e.reply.voice(ogg); // recado de voz; `audio` é arquivo de áudio
await e.reply.sticker(webp);
await e.reply.document(pdf, { fileName: 'boletim.pdf', mimetype: 'application/pdf' });
await e.reply.album([
  { type: 'image', media: foto1 },
  { type: 'image', media: foto2 },
]);

await send.send(chatId, { type: 'image', media: buffer, caption: 'para outro chat' });
```

Cada tipo depende de uma capability do transport (`send.image`, `send.sticker`, `send.album`...).
Sem ela, o envio rejeita com `UnsupportedError`. Declare em `requires` o que o plugin não funciona
sem, e confira em `ctx.capabilities` o que é opcional ([Capabilities](capabilities.md)).

## Testar

```ts
import { createTestBot, fixtures } from '@zapforge/testing';

const bot = await createTestBot({ plugins: [meuPlugin] });
await bot.receive({ image: fixtures.image() });
await bot.emit('group.participants', {
  chat: { id: 'grupo@fake', isGroup: true },
  action: 'add',
  participants: [{ id: 'novo@fake', name: 'Novo', phone: null }],
  actor: null,
});
```

`fixtures` traz uma mídia válida de cada tipo, para plugins que decodificam o arquivo. Mais em
[Testes](testes.md).
