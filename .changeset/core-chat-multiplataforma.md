---
'@zapforge/core': minor
---

O `Chat` ganha os campos opcionais `kind` (`'dm' | 'group' | 'channel' | 'thread'`, tipo
exportado `ChatKind`), `parentId` (o espaço a que o chat pertence: o servidor do Discord ou o
supergrupo do Telegram) e `title`. Um `Chat` só com `id` e `isGroup` continua válido.

O `chatFilter` passa a casar `allow` e `block` também contra o `chat.parentId`: liberar ou
bloquear um servidor vale para todos os canais dele, e um canal bloqueado continua de fora com o
servidor liberado. No WhatsApp não há `parentId`, então nada muda lá.
