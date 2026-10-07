---
'@zapforge/core': minor
---

Conflito de papel (`RoleConflictError`) ou de serviço (`ServiceConflictError`) no `setup` passa a derrubar o boot, como o conflito de comando, conforme o ADR 0035. Antes, o plugin que chegava depois era só ignorado, e quem respondia pelo papel ou serviço dependia da ordem de carga. Num `reload`, o conflito continua só ignorando o plugin recarregado.
