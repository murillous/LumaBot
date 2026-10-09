# @zapforge/testing — documentação

Kit para testar plugins sem rede. Ele sobe um `Bot` de verdade (plugins, filas, middlewares,
roteador) sobre o `FakeTransport`, que guarda o que o bot envia. O porquê das escolhas está no
[ADR 0052](../../../docs/adr/0052-kit-de-testes-sobre-o-vitest.md).

## Instalação

```sh
pnpm add -D @zapforge/testing vitest
```

O kit funciona só com o Vitest (`vitest` é peer dependency). Importar o pacote registra os
matchers. Não é preciso configurar nada no `vitest.config`.

## Primeiro teste

```ts
import { createTestBot, fixtures } from '@zapforge/testing';
import { afterEach, expect, it } from 'vitest';
import { sticker } from './index.ts';

it('imagem com !s vira figurinha', async () => {
  const bot = await createTestBot({ plugins: [sticker()] });

  await bot.receive({ text: '!s', image: fixtures.image() });

  expect(bot.sent).toContainSticker();
  await bot.stop();
});
```

O `receive()` resolve depois que o bot terminou de processar a mensagem (`bot.settled()`). Nesse
momento, o que ela causou já está em `bot.sent`, inclusive os envios feitos sem `await`. Por isso
o teste não precisa de `sleep`.

Chame `bot.stop()` no fim de cada teste, ou guarde os bots e pare todos no `afterEach`. O
`stop()` roda o `teardown` dos plugins e fecha o storage.

## `createTestBot(options)`

Recebe a mesma config do `createBot`, menos o `transport`, que é opcional, e devolve o bot já
iniciado. Os padrões mudam para o caso de teste:

| Opção | Padrão no kit | Por quê |
| --- | --- | --- |
| `transport` | `new FakeTransport()`, com todas as capabilities | |
| `logger` | `silent` | Saída limpa. Com `logLevel`, o bot cria o logger dele |
| `env` | `{}` | Nenhum `ZAPFORGE_*` da máquina entra na config dos plugins |
| `outbound` | `globalIntervalMs` e `chatIntervalMs` em 0 | Os envios saem na hora |
| `reconnection` | `false` | |
| `storage` | em memória (padrão do core) | |

Qualquer opção pode ser sobrescrita, por exemplo `pluginConfig`, `owners`, `prefix` ou `storage`.

### `TestBot`

| Membro | O que faz |
| --- | --- |
| `receive(input)` | Entrega uma mensagem, espera o bot assentar e devolve a `Message` entregue |
| `emit(event, payload)` | Simula outro evento do transport (`reaction`, `group.joined`...) e espera o bot assentar |
| `sent` | Os envios, na ordem (`SentMessage[]`) |
| `transport` | O `FakeTransport`, com os outros registros |
| `bot` | O `Bot` (`plugins()`, `stats()`, `config`...) |
| `stop()` | Para o bot |

## Mensagem de entrada

O `receive()` recebe só o que importa para o teste. O resto vem preenchido com padrões:

```ts
await bot.receive({ text: 'oi' });                               // texto
await bot.receive({ text: 'legenda', image: buffer });           // imagem com legenda
await bot.receive({ voice: { data: buffer, mimetype: 'audio/ogg' } });
await bot.receive({ document: buffer, fileName: 'a.pdf' });
await bot.receive({ text: '!s', quoted: { image: buffer } });    // respondendo uma imagem
await bot.receive({ text: 'oi', chat: { id: 'grupo@fake', isGroup: true } });
await bot.receive({ text: '!config', sender: { phone: '5511999999999' } });
```

| Campo | Padrão |
| --- | --- |
| `chat` | `DEFAULT_CHAT` (`chat@fake`, conversa privada). Uma string vira conversa privada com esse ID |
| `sender` | `DEFAULT_SENDER` (`user@fake`, telefone `5511900000000`). Os campos informados substituem os do padrão |
| `id` | Um ID único |
| `timestamp` | `Date.now()` |
| `fromMe`, `isForwarded`, `isViewOnce` | `false` |

As mídias aceitas são `image`, `video`, `audio`, `voice`, `sticker` e `document`, no máximo uma
por mensagem. Quando a mídia vem só como `Buffer`, o mimetype é o que o WhatsApp usa para o tipo:
`image/jpeg`, `video/mp4`, `audio/mpeg`, `audio/ogg; codecs=opus`, `image/webp` e
`application/octet-stream`. O `quoted` aceita uma descrição como esta ou uma `Message` pronta.

## Fixtures

Um plugin que decodifica a mídia (sharp, ffmpeg) falha com bytes quaisquer, como
`Buffer.from('...')`. O `fixtures` tem uma mídia válida e pequena de cada tipo, pronta para o
`receive()`:

```ts
import { createTestBot, fixtures } from '@zapforge/testing';

await bot.receive({ text: '!s', image: fixtures.image() });
await bot.receive({ text: '!s', quoted: { video: fixtures.video() } });
await bot.receive({ document: fixtures.document(), fileName: 'a.pdf' });
```

| Fixture | Formato | Mimetype |
| --- | --- | --- |
| `image()` | JPEG 16×16 | `image/jpeg` |
| `video()` | MP4 (H.264) 16×16, 1 s, sem áudio | `video/mp4` |
| `audio()` | MP3 mono, 1 s de silêncio | `audio/mpeg` |
| `voice()` | OGG/Opus mono, 1 s de silêncio | `audio/ogg; codecs=opus` |
| `sticker()` | WebP 512×512 | `image/webp` |
| `document()` | PDF de uma página em branco | `application/pdf` |

Cada chamada devolve `{ data, mimetype }` com um `Buffer` novo, então alterar os bytes num teste
não afeta os outros. Para enviar só os bytes, use `fixtures.sticker().data`.

As mídias ficam em base64 em `src/fixtures.ts`, para o pacote não depender de arquivos fora do
`dist`. Para gerar de novo, use o ffmpeg (o PDF foi escrito à mão):

```sh
ffmpeg -f lavfi -i color=c=0x3366cc:s=16x16 -frames:v 1 -q:v 10 image.jpg
ffmpeg -f lavfi -i color=c=0x3366cc:s=512x512 -frames:v 1 -c:v libwebp -lossless 1 sticker.webp
ffmpeg -f lavfi -i color=c=0x3366cc:s=16x16:r=1 -t 1 -c:v libx264 -pix_fmt yuv420p -movflags +faststart video.mp4
ffmpeg -f lavfi -i anullsrc=r=8000:cl=mono -t 1 -c:a libmp3lame -b:a 8k audio.mp3
ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 1 -c:a libopus -b:a 6k voice.ogg
```

Para testar um comando `role: 'owner'`, passe `owners: [DEFAULT_SENDER.phone]` ao
`createTestBot`, ou `owners: [{ id: DEFAULT_SENDER.id }]` para simular uma plataforma sem
telefone.

Um remetente de fora do WhatsApp sai do `sender`: sem telefone, com `@usuario` e com os claims
que o transport verificou. Uma mensagem com `sender: { isBot: true }` é barrada pelo
`ignoreBots`, que vem ligado.

```ts
await bot.receive({
  text: '!notas',
  sender: { id: 'u-42', phone: null, username: 'ana', claims: { papel: 'diretora' } },
});
```

Um chat de fora do WhatsApp sai do `chat`: com o tipo, o espaço e o título. A resposta do
`reply` vai para o `chat.id`:

```ts
await bot.receive({
  text: '!avisos',
  chat: { id: '-100123/45', isGroup: true, kind: 'thread', parentId: '-100123', title: 'Avisos' },
});
```

## Matchers

Os matchers recebem `bot.sent` ou o próprio `TestBot`:

| Matcher | Passa quando |
| --- | --- |
| `toContainText(text?)` | Algum envio é texto. Com `text`, o texto é igual à string ou casa com a RegExp |
| `toContainSticker()` | Algum envio é figurinha |
| `toContainImage()` | Algum envio é imagem |
| `toHaveReplied(text?)` | Algum envio cita uma mensagem, como faz o `ctx.reply`. Com `text`, é uma resposta de texto com esse conteúdo |

Todos funcionam com `.not`. Quando um matcher falha, a mensagem lista o que foi enviado:

```
esperava enviar uma figurinha; enviados:
  - "Mande ou responda uma imagem/vídeo 🙂" (resposta)
```

Para conferir outros detalhes, use os registros direto:
`expect(bot.sent[0]?.content).toEqual({ type: 'sticker', media })`.

## `FakeTransport`

O `FakeTransport` implementa o `Transport` do core sem rede. Ele também serve para testar um
`Bot` montado à mão com `createBot({ transport })`.

```ts
const transport = new FakeTransport({
  capabilities: ['send.text', 'quoted'],  // padrão: todas
  groups: [{ id: 'grupo@fake', title: 'Grupo', description: null, ownerId: null, participants }],
});
const bot = await createTestBot({ transport, plugins: [meuPlugin()] });
```

| Membro | O que faz |
| --- | --- |
| `sent` | Envios: `{ chatId, content, quoted, mentions, key }` |
| `reactions`, `edits`, `deletions` | `react`, `edit` e `delete`, com a `MessageKey` devolvida pelo envio |
| `presences`, `participantUpdates` | `sendPresence` e `updateGroupParticipants` (que cobra `groups.add`, `groups.remove` ou `groups.promote`, conforme a ação) |
| `errors` | Erros lançados pelos handlers de eventos emitidos. O bot trata os próprios erros, então a lista deve ficar vazia |
| `emit(event, payload)` | Simula um evento do canal sem esperar o bot. Prefira o `bot.emit` |
| `setGroup(metadata)` | Registra o grupo que `getGroupMetadata` devolve. Um grupo não registrado faz a chamada falhar |
| `clear()` | Esvazia os registros de saída |

Um método ligado a uma capability que o transport não declara lança `UnsupportedError`, como no
transport real. Um plugin que exige essa capability (`requires`) é ignorado no boot, e
`bot.bot.plugins()` mostra o motivo.

O `self` é `null` até o `connect()` e depois vale `DEFAULT_SELF`, ou o `self` passado nas opções.

## Fora do Vitest: `@zapforge/testing/bot`

O entry principal importa o `vitest` para registrar os matchers. Para subir o bot de teste fora de
um teste, como num benchmark ou num script, importe de `@zapforge/testing/bot`. Ele exporta o
mesmo (`createTestBot`, `FakeTransport`, `fixtures`...), sem os matchers e sem carregar o Vitest.

```ts
import { createTestBot } from '@zapforge/testing/bot';
```

## Limites

- O `settled()` não espera os jobs do scheduler. Para testar um job, chame o handler direto ou
  espere o efeito dele.
