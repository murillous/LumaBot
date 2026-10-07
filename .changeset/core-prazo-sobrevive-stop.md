---
'@zapforge/core': patch
---

O `stop()` desarma o prazo de comando, `onReject`, checagem de papel, consulta de admin do grupo e
listener presos (#247). Antes, o timer de um handler que nunca resolvia sobrevivia ao `stop()` por
até 30 s: emitia `plugin.error` e log de timeout de um bot já parado e segurava o processo vivo.
