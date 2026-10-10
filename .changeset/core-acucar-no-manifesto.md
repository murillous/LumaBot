---
'@zapforge/core': minor
---

Forma curta do plugin (ADR 0079). O manifesto aceita `commands` (nome → comando) e `on`
(evento → listener), com o contexto do plugin no 2º argumento; o kernel os registra com
`ctx.commands.add`/`ctx.events.on` antes do `setup`, que passa a ser opcional. Declarar `commands`
já exige `send.text`. O manifesto valida comando sem `run`, nome inválido e evento desconhecido,
para quem escreve em JavaScript. Novos tipos: `PluginCommand`, `PluginListener` e
`PluginListeners`.

**Mudança de comportamento:** no bot, o `run` de qualquer comando que devolve texto (string ou
`fmt`) responde com ele, citando a mensagem. Quem devolvia uma string sem querer passa a
responder; outros valores, como a chave de um `c.reply(...)` devolvido, seguem ignorados.
