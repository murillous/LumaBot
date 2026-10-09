---
'@zapforge/core': minor
---

Vários anexos na mensagem e envio em álbum (ADR 0065).

- `Message.attachments` em toda mensagem: todas as mídias, na ordem da plataforma, vazio sem
  mídia. Nos tipos de mídia, `attachments[0]` é o próprio `media`, e o `type` é o do primeiro
  anexo. O `accepts` e o `ctx.media` não mudam.
- `Media.fileName` e `MediaSource.fileName` opcionais. O `MessageInit` aceita `attachments` como
  lista de `MediaSource`, começando pela `media`; o `createMessage` lança `TypeError` se não
  começar, ou se vier anexo num tipo sem mídia.
- `OutgoingContent` ganha `{ type: 'album', items, caption?, formattedCaption? }`, com itens
  `image`, `video` ou `document` (tipo `AlbumItem`), e `ctx.reply.album(items, { caption })`
  (`ReplyAlbumOptions`).
- Capability `send.album` e `limits.album`. Com a capability, a fila envia o álbum em lotes de
  até `limits.album` itens; sem ela, item a item, com a legenda no primeiro. Lote de um item sai
  como mensagem comum, e álbum vazio rejeita com `TypeError`.
- Quem monta `Message` à mão precisa do campo `attachments`, e um transport com `switch`
  exaustivo sobre o `OutgoingContent` precisa tratar o `album`.
