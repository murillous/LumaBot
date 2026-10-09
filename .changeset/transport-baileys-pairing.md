---
'@zapforge/transport-baileys': patch
---

O Baileys declara a capability `pairing`: credencial rejeitada (403, 411) continua limpando a
sessão e pareando de novo, em vez de parar o bot como num transport por token (ADR 0068).
