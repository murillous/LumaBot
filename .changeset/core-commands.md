---
'@zapforge/core': minor
---

Roteador de comandos (M1-6): `command()` para declarar comandos, prefixo configurável, aliases,
match por token inicial exato (sem diferenciar caixa), parse de args com aspas, `accepts`
(incluindo `quoted:*`) com `ctx.media` resolvido e `onReject`, papéis `owner` / `group-admin` /
`everyone` e `CommandConflictError` quando dois comandos disputam o mesmo nome ou alias.
