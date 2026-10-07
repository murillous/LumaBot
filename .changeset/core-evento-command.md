---
'@zapforge/core': minor
---

Novo evento `command` (#254, ADR 0049): sai depois de todo comando que casou, com
`{ plugin, name, invokedAs, status, message }` e `status` `ran`, `rejected` ou `failed`. É só de
observação (sem `reply`) e, junto com `message`, deixa o plugin ver toda mensagem, comandos
inclusive. Exporta o tipo `CommandEvent`.
