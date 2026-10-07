---
'@zapforge/core': patch
---

Scheduler: jobs sem handler (plugin desligado, job renomeado) saem das consultas do loop. Antes eram relidos do storage a cada disparo, e o custo crescia com o acúmulo; agora também não armam timer (#228).
