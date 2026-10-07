---
'@zapforge/core': minor
---

Service registry entre plugins (M1-9): `createServiceRegistry()` com `forPlugin(name)` (o
`ctx.services` do plugin, com `provide`/`get`/`has` tipados por declaration merging em
`Services`) e `removePlugin(name)` para teardown/reload. `get` de serviço ausente lança
`ServiceNotFoundError`, e prover um nome já provido lança `ServiceConflictError` citando os
dois plugins. `ServiceName` passa a conter só as chaves string de `Services`.
