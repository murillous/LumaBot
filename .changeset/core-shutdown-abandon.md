---
'@zapforge/core': patch
---

Corrige o shutdown do `Bot` (M1-16): nada do bot sobrevive ao `stop()`. Antes, com o prazo total
esgotado, os ganchos do scheduler e da fila de saída eram pulados e o timer do scheduler seguia
rearmando contra o storage já fechado, segurando o processo vivo. Agora, depois dos ganchos, o bot
abandona o que restou: solta os eventos do transport, para a reconexão, descarta o que aguarda
nas filas, abandona os jobs em andamento (que ficam no storage para a próxima subida) e o
`teardown` em curso, e faz o `dispose` de todos os plugins. O scheduler passa a parar antes do
`teardown` dos plugins, e os prazos dos ganchos internos passam a somar o total padrão (15 s).
`stop()` durante o `setup` dos plugins não conecta mais o transport. `InboundQueue.close`
aceita `{ drain: false }`, e `SchedulerService.stop` e `PluginHost.stop` aceitam um
`AbortSignal` que abandona o trabalho em curso.
