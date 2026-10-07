---
'@zapforge/core': minor
---

Prazo em todo código de plugin e consulta ao transport no caminho do comando (M1-6, M1-16). O
`onReject` passa a ter o mesmo prazo do `run` (`timeouts.commandMs`, contado à parte), com
`signal` e `reply` presos a ele: `RejectContext` ganha `signal`, e `CommandTimeoutError` ganha
`stage` (`'run'` ou `'onReject'`). A consulta de admin do grupo (`role: 'group-admin'`) também tem
prazo e, estourada, rejeita com o novo `GroupAdminTimeoutError` (`plugin.error` com
`timedOut: true`). Antes, um `onReject` ou um `getGroupMetadata` que nunca resolvia prendia o chat
para sempre. `registry.add` (e `ctx.commands.add`) passa a validar nome e aliases como `command()`,
lançando `TypeError` no boot em vez de registrar um comando que nunca casa.
