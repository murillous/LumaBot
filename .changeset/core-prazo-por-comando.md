---
'@zapforge/core': minor
---

Comando pode declarar o próprio prazo com `command({ timeoutMs })` (#227, ADR 0042). Ele vale para
o `run` e o `onReject` daquele comando; sem ele, vale `timeouts.commandMs`. Um download de minutos
não obriga mais a subir o prazo de todos os comandos. `timeoutMs` que não seja finito e > 0 falha
no registro com `RangeError`.
