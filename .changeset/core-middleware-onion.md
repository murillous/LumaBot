---
'@zapforge/core': patch
---

Os middlewares passam a envolver comando e listeners, como o ADR 0012 define (#225). Antes,
o código depois de `await next()` rodava antes do comando. Agora ele roda quando comando e
listeners terminam (ou estouram `commandMs`/`listenerMs`). Isso vale também para a edição
(`message.edited`). Um middleware passa a medir o tratamento inteiro, a manter o "digitando"
ou a liberar um recurso no fim.
