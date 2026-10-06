---
'@zapforge/core': minor
---

Adiciona `InboundQueue`, a fila de entrada por chat: serializa o mesmo chat e paraleliza chats
distintos, com limite de backlog por chat, métricas (`stats()`) e shutdown gracioso
(`close()`/`onIdle()`).
