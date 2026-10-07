---
'@zapforge/core': minor
---

Boot sequencial e cancelamento cooperativo (M1-16). O `start()` volta à ordem do plano: carrega
os plugins e só então chama `transport.connect()` — plugin quebrado (ex.: conflito de comando)
faz o `start()` rejeitar sem conectar. Comandos (`c.signal`), listeners (`e.signal`), handlers de
job (`(payload, { signal })`) e o `PluginContext` (`ctx.signal`) ganham um `AbortSignal` que
aborta no prazo (ou no descarte do contexto), reaproveitando os timers que já existiam. Depois
do prazo, o `reply` daquele contexto rejeita com o novo `ContextExpiredError`; depois do descarte
do plugin, `send`, `storage` e `scheduler.at`/`cancel` também. `PluginContextHandle.dispose`
aceita o motivo do descarte, e `EventBus.forPlugin` aceita uma visão por listener (uso do kernel).
