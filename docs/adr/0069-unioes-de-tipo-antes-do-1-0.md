# ADR 0069 — Uniões de tipo de mensagem e de conteúdo antes do 1.0

**Status:** Aceito (2026-10-09) · Detalha **D09** ([ADR 0009](0009-modelo-de-mensagem-normalizado.md)),
**D10** ([ADR 0010](0010-capabilities-do-transporte.md)) e **D27**
([ADR 0027](0027-releases-changesets.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

`MessageType` e `OutgoingContent` nasceram com a lista do WhatsApp: `voice` separado de `audio`,
`sticker`, as flags `isViewOnce` e `isForwarded` (#272). O que outras plataformas têm a mais cai em
`unknown`: no Telegram, `animation` (GIF), `video_note`, `dice`, `venue`, `game`, `invoice` e
`story`; no Discord, a mensagem só com embed ou componentes; no web, cards. Acrescentar um membro a
uma dessas uniões quebra o `switch` exaustivo de um plugin ou de um transport (o `never` do
`default` deixa de compilar). Depois do 1.0, cada adição viraria major.

A investigação respondeu às perguntas da issue:

- **Lista final de tipos.** Nada do Telegram ou do Discord pede membro novo:
  - `animation` é um MP4 sem som, e `video_note`, um vídeo redondo. O Baileys já entrega o GIF do
    WhatsApp (`gifPlayback`) e o recado de vídeo (`ptv`) como `video`. O mimetype distingue o GIF
    quando a plataforma manda `image/gif`.
  - `venue` é uma localização com nome e endereço. Cabe em `location` com um campo opcional novo.
  - `dice`, `game`, `invoice`, `story` e a mensagem só com embed ou componentes não têm leitura
    comum entre plataformas. Ficam `unknown`, e o plugin específico usa o objeto bruto
    (`ctx.unsafe.raw`, ADR 0066).
- **`voice` e `audio`.** Não é peculiaridade do WhatsApp: o Telegram tem `voice` e `audio`
  separados, e o Discord, a mensagem de voz com forma de onda.
- **`isViewOnce`.** Só o WhatsApp tem visualização única para bots. Como `boolean`, fica `false` nas
  outras plataformas, que é a resposta certa: a mensagem não é de visualização única. Torná-lo
  opcional não ganharia nada, e `if (m.isViewOnce)` se lê igual.
- **`sticker` de saída.** O Discord não deixa bot enviar figurinha arbitrária, só as do servidor
  pelo ID. O envio já fica atrás de `send.sticker`: o transport do Discord não a declara, e o
  plugin que exige figurinha é recusado no boot.
- **Mimetypes do kit.** Os padrões do `receive()` (`audio/ogg; codecs=opus` para `voice`,
  `image/webp` para `sticker`) são também os do Telegram. Só o comentário dizia "do WhatsApp".
- **Conteúdo rico de saída.** Card ou embed (título, descrição, imagem, botões) já tem uma forma
  aproximada: imagem com legenda formatada (ADR 0061) e ações (ADR 0062). O caso real é o
  `transport-web` (M3), ainda sem desenho.
- **O que depende do ponto.** `types.ts` da mensagem e do transport, o `createMessage`, o roteador
  (só lê `type` e `media`), a fila de saída, o `toContent` e o `normalize` do Baileys, o kit e os
  `*.test-d.ts`. Nenhum `switch` exaustivo do repositório depende de membro novo.

Alternativas consideradas:

- **Uniões abertas**, com um membro `{ type: string & {} }`. Nunca quebram, mas `case 'image'`
  deixa de estreitar para `ImageMessage`: o membro genérico também aceita `'image'`, e `media`
  some do tipo. Perde a razão de ter uma união discriminada.
- **Tipos novos agora** (`animation`, `videoNote`). Para o plugin, um GIF e um recado de vídeo se
  tratam como vídeo: baixar, converter, responder. Tipos à parte tirariam essas mensagens do
  `accepts: ['video']` e do `message:video` sem ganho.
- **Só capability e objeto bruto, sem política.** Deixa a próxima adição sem regra: seria major
  depois do 1.0, e cada uma pediria a mesma discussão.
- **`isViewOnce` opcional**, como os campos de plataforma dos ADRs 0057 e 0058. Ausente e `false`
  diriam a mesma coisa.
- **`card` agora**, com `send.card` e fallback na fila. Desenho sem o transport que o usaria; entra
  pela política abaixo quando o `transport-web` pedir.

## Decisão

- **As uniões continuam fechadas.** `MessageType`, `Message` e `OutgoingContent` seguem como
  uniões discriminadas, sem membro genérico.
- **Acrescentar membro é minor**, inclusive depois do 1.0, desde que:
  - na entrada, o que vira o tipo novo chegava antes como `unknown`;
  - na saída, o membro novo venha com capability nova. A fila só o entrega a quem a declara.
- **Regra para o autor.** Plugin trata `unknown` e qualquer tipo que não conhece; `switch` sobre
  `type` sempre com `default`, nunca com o `never` exaustivo. Transport faz o mesmo sobre
  `content.type`, com `UnsupportedError` no `default`. A regra fica nas docs do core
  (`message.md`, `transport.md`) e nos comentários dos tipos.
- **Mapeamento das plataformas:**
  - GIF (`animation` do Telegram, `gifPlayback` do WhatsApp) e recado de vídeo (`video_note`,
    `ptv`) chegam como `video`. Um GIF enviado como imagem chega como `image` com `image/gif`.
  - `venue` do Telegram chega como `location`, com o nome em `name` e o endereço no campo novo.
  - `dice`, `game`, `invoice`, `story` e mensagem só com embed ou componentes chegam como
    `unknown`, e o resto fica no `ctx.unsafe.raw`.
- **`LocationMessage.location.address`**, opcional: o endereço, quando a plataforma informa
  (`venue` do Telegram, `address` da localização do WhatsApp). O Baileys passa a preenchê-lo e
  mantém `name` como estava, com o endereço no lugar do nome que falta.
- **`isViewOnce` e `isForwarded` continuam `boolean`**, `false` onde a plataforma não tem o
  conceito.
- **`sticker` continua de primeira classe**, atrás de `send.sticker`.
- **Nada de `card` agora.** Entra como membro novo de `OutgoingContent`, com capability própria,
  quando o `transport-web` tiver desenho.

## Consequências

- Mudança aditiva: o campo `address` é opcional, e nenhuma união ganhou ou perdeu membro.
- A política transforma a próxima adição em minor, mas só para quem segue a regra: um plugin com
  `switch` exaustivo deixa de compilar na atualização. É o custo de manter o narrowing.
- Na entrada, um tipo novo muda o comportamento de quem tratava aquele caso como `unknown`. O
  changeset da adição precisa dizer o que deixou de ser `unknown`.
- O GIF e o recado de vídeo seguem indistinguíveis de um vídeo comum, a não ser pelo mimetype ou
  pelo objeto bruto. Uma flag dedicada entra por adição se algum plugin precisar.
- O kit não muda de comportamento: só o comentário dos mimetypes padrão.
