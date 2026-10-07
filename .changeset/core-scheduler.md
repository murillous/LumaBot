---
'@zapforge/core': minor
---

Scheduler persistido (M1-11): `createSchedulerService({ storage, onError, onStorageError })`
com `forPlugin(nome)` (`ctx.scheduler`: `at`/`on`/`cancel`, jobs no namespace do plugin),
`removePlugin`, `start` e `stop`. Os jobs ficam em `kernelStorage(storage, 'scheduler')`,
sobrevivem a restart e os vencidos durante o downtime disparam ao subir. Um único timer serve o
bot inteiro. A entrega é pelo menos uma vez: o job sai do storage só depois do handler, e as
falhas viram `plugin.error` com `phase: 'scheduler'`. Novo erro `JobHandlerConflictError`.
