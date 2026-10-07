---
'@zapforge/core': minor
---

Papéis custom nomeados (M1-19, ADR 0035). `ctx.roles.define(nome, check)` deixa um plugin definir
um papel que qualquer plugin exige com `role: 'nome'`, tipado por declaration merging em
`interface Roles`. O roteador avalia: owner passa sem consultar; o `check` (com `signal` e o `log`
do plugin dono) roda com o prazo de `timeouts.commandMs` e só `true` concede; erro, rejeição ou
prazo estourado recusam o comando (fail-closed) e viram `plugin.error` do dono do papel, na nova
`phase: 'role'` (`RoleTimeoutError` no prazo). Papel sem dono carregado recusa e loga erro.
Nomes reservados lançam `TypeError` e nome já definido lança `RoleConflictError`; o papel sai no
teardown/reload. Exporta `Roles`, `RoleName`, `RoleCheck`, `RoleContext`, `RoleConflictError` e
`RoleTimeoutError`.
