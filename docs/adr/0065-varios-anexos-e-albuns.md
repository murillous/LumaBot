# ADR 0065 — Vários anexos na mensagem e envio em álbum

**Status:** Aceito (2026-10-09) · Detalha **D09** ([ADR 0009](0009-modelo-de-mensagem-normalizado.md)),
**D10** ([ADR 0010](0010-capabilities-do-transporte.md)) e **D61**
([ADR 0061](0061-texto-formatado-neutro.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

A `Message` de mídia carregava uma `media` só, e o `OutgoingContent` enviava uma mídia por vez
(#271). No Discord, uma mensagem traz até dez anexos de tipos quaisquer junto com o texto; os
outros se perdiam na entrada e não havia como enviá-los. No Telegram, as fotos de um álbum chegam
como updates separados com o mesmo `media_group_id`. No web, anexar vários arquivos é comum.

A investigação respondeu às perguntas da issue:

- **`type` com tipos diferentes.** O roteador, o `accepts`, o `ctx.media`, o evento
  `message:<type>` e o kit leem o `type` e a `media`. Um tipo novo para a mistura (imagem + PDF)
  tiraria essas mensagens de todos os filtros que já existem.
- **Álbum do Telegram.** Juntar os updates exige esperar alguns instantes pelo resto do grupo.
  Quem conhece o `media_group_id` e a janela da plataforma é o transport. Deixar para o plugin
  poria um campo do Telegram no contrato e faria cada plugin de mídia juntar as fotos sozinho.
- **Envio.** O Telegram envia o álbum com `sendMediaGroup`: de 2 a 10 itens, e documento não se
  mistura com foto ou vídeo. O Discord aceita até 10 anexos de qualquer tipo numa mensagem. O
  Baileys não monta álbum: o WhatsApp agrupa sozinho as imagens enviadas em sequência.
- **Limite de tamanho de arquivo** (#273, #284). Fica fora daqui: vale para uma mídia avulsa do
  mesmo jeito que para um álbum.
- **O que depende do ponto.** `MessageInit` e `createMessage`, `Media`, o roteador (só lê `type`
  e `media`), a fila de saída (divisão da legenda, ADR 0061), `ctx.reply`, as capabilities, o
  `toContent` do Baileys e o `receive()` do kit. Tudo pode crescer por adição.

Alternativas consideradas:

- **`media` vira array.** Mais limpo, mas quebraria todo plugin de mídia antes do 1.0 sem ganho
  para quem lê uma mídia só.
- **`attachments` só nos tipos de mídia.** O plugin teria de estreitar o tipo antes de iterar, e
  um texto não teria como dizer "sem anexos".
- **Tipo `mixed` para tipos diferentes.** Tiraria a mensagem do `accepts` e do `message:image`
  quando a primeira mídia é uma imagem.
- **`mediaGroupId` na mensagem, e o plugin junta.** Campo de uma plataforma no contrato, e o
  trabalho repetido em cada plugin.
- **Álbum que exige a capability.** Cada plugin teria de escrever o mesmo fallback item a item.
- **Só a entrada agora.** O plugin de documentos no web e o de mídia (#131) continuariam sem
  como enviar vários arquivos.
- **`accepts` procurando em todos os anexos.** Mudaria a semântica do `accepts` e custaria uma
  volta pelos anexos por comando.

## Decisão

- **`Message.attachments`**, em toda mensagem: `readonly Media[]`, na ordem da plataforma. Vazio
  sem mídia. Nos tipos de mídia, `media` continua lá e é o mesmo objeto que `attachments[0]`, com
  o mesmo cache de download.
- **`type` é o do primeiro anexo.** Imagem seguida de PDF é `image`. O roteador, o `accepts`, o
  `ctx.media` e o `message:<type>` não mudam: olham o `type` e a `media`. O comando que quer os
  outros lê `ctx.accepted.message.attachments` (ou `ctx.message.attachments`).
- **`Media.fileName`**, opcional: o nome do arquivo de cada anexo, quando a plataforma informa.
  `DocumentMessage.fileName` continua valendo para a primeira mídia.
- **Construção.** O `MessageInit` aceita `attachments` como lista de `MediaSource`. Nos tipos de
  mídia, a lista começa pela própria `media`; o `createMessage` lança `TypeError` se não começar,
  ou se vier anexo num tipo sem mídia. Sem a lista, `attachments` é `[media]` ou `[]`.
- **O álbum é juntado no transport.** Ele espera os updates do mesmo grupo e emite uma
  `message` só, com todos os anexos. O core não conhece `media_group_id`. O timer da espera é do
  transport e morre no `disconnect()`.
- **Envio com `{ type: 'album', items, caption? }`.** Os itens são `image`, `video` ou
  `document` (com `fileName` e `mimetype`), sem legenda própria. A legenda é do álbum, crua ou
  formatada (ADR 0061). `ctx.reply.album(items, { caption })` é o atalho, citando a mensagem.
- **Capability `send.album`, com fallback na fila.** Com ela, o álbum vai inteiro ao transport.
  Sem ela, a fila envia cada item como mensagem comum, a legenda no primeiro. As duas formas
  exigem a capability de cada tipo de item (`send.image`, `send.document`...). O álbum vazio
  rejeita com `TypeError`.
- **`limits.album`**, máximo de itens num álbum. Acima dele, a fila divide em lotes, a legenda no
  primeiro. Um lote de um item sai como mensagem comum, porque o Telegram não aceita álbum de
  um. As regras de partes do ADR 0061 valem: só a primeira parte cita, as menções vão em todas, a
  chave é a da primeira, e a legenda acima de `limits.caption` continua em texto.
- **O que a plataforma não aceita junto é do transport.** No Telegram, documento e foto viram
  dois álbuns, e a chave devolvida é a do primeiro.

## Consequências

- Mudança aditiva: `attachments` sai preenchido do `createMessage`, e o transport que não o
  informa segue igual. Quem monta `Message` à mão, fora do `createMessage`, precisa do campo novo.
- O `OutgoingContent` ganha o membro `album`: um transport com `switch` exaustivo sobre o `type`
  precisa tratá-lo, nem que seja com `UnsupportedError`, porque a fila só o entrega a quem
  declara `send.album`.
- `send.album` entra na lista de capabilities, e os tipos `AlbumItem` e `ReplyAlbumOptions`, na
  API pública.
- O Baileys não declara `send.album`: no WhatsApp, o álbum sai item a item pela fila.
- O `receive()` do kit aceita `attachments` além da mídia principal.
- O caminho quente ganha um array por mensagem de mídia. A mensagem de texto compartilha um
  array vazio congelado.
- O limite de tamanho de arquivo (#273, #284) segue aberto, igual para mídia avulsa e álbum.
