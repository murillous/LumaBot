---
'@zapforge/testing': minor
---

Fixtures de mídia (#114): `fixtures.image()`, `video()`, `audio()`, `voice()`, `sticker()` e
`document()` devolvem `{ data, mimetype }` com uma mídia pequena e válida de cada tipo, pronta
para o `bot.receive()`. Um plugin que decodifica a mídia (sharp, ffmpeg) agora pode ser testado
sem arquivos próprios.
