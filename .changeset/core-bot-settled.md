---
'@zapforge/core': minor
---

`bot.settled()` espera o bot terminar de processar o que recebeu (#237): resolve quando a fila de
entrada, os listeners em andamento (inclusive de eventos diretos e `plugin.error`) e a fila de
saída estão ociosos ao mesmo tempo, repetindo a espera enquanto um realimenta o outro. Durante o
boot, espera os plugins subirem; com a fila de saída pausada, espera a reconexão ou o
`maxPauseMs`. Jobs do scheduler ficam de fora. Nunca rejeita. É a base do `receive()` do
`@zapforge/testing` e permite afirmar em teste que nada foi enviado (ADR 0044).
