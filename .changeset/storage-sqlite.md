---
'@zapforge/storage-sqlite': minor
---

Novo pacote: `sqlite({ path })` (#109). É o adapter de storage padrão e implementa KV, coleções e
auth state sobre o `node:sqlite`, sem addon nativo. O banco abre em WAL, e as migrations do
adapter rodam no boot. Passa na suíte de contrato do core, inclusive na persistência ao reabrir.
