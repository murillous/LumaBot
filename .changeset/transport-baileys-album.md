---
'@zapforge/transport-baileys': patch
---

O Baileys não declara `send.album`: no WhatsApp, a fila envia o álbum item a item. O `toContent`
lança `UnsupportedError` para o `album`, que só chega se alguém pular a checagem (ADR 0065).
