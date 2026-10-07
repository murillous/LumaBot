---
'@zapforge/core': minor
---

Adiciona o `StoragePort` completo: KV e coleções por namespace (`insert`, `get`, `find` com
filtros `eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`in`, ordenação, `limit`/`offset`, `update`, `delete`,
índices declarados), auth state por sessão para o transport (`authState`), namespaces
reservados ao kernel (`pluginStorage`/`kernelStorage`), o adapter em memória
`createMemoryStorage()` e a suíte de contrato reutilizável em
`@zapforge/core/storage-contract` (`defineStorageContract`).
