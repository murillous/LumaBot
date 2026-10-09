---
'@zapforge/transport-baileys': minor
---

`raw()` devolve o `WAMessage` de onde a mensagem saiu, para o `ctx.unsafe.raw()` (ADR 0066). A
citada devolve o proto montado do `contextInfo`, sem `pushName` nem horário.
