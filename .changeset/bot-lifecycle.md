---
'@zapforge/core': minor
---

Adiciona `createBot(config)` com `start()`/`stop()`, máquina de estados (`bot.state`) e ganchos
de parada (`onStop`) para shutdown gracioso, sem estado global nem side effect em import.
