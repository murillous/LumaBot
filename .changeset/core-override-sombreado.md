---
'@zapforge/core': minor
---

`bot.config.describe` devolve `sources`, a fonte (`default`, `override`, `file` ou `env`) de cada campo da config e de cada mensagem, e `setOverrides` loga um aviso com os campos que o arquivo ou o env sombreiam, sem os valores. Antes, um override sem efeito era salvo em silêncio.
