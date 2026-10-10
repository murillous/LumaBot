---
'@zapforge/storage-postgres': minor
---

Novo pacote: `await postgres({ connectionString, schema })` (#119). Adapter de storage para vários
processos dividindo o banco: KV, coleções (documentos em `jsonb`), auth state e a trava de sessão
pelo relógio do servidor, num schema Postgres próprio (`zapforge` por padrão). As migrations do
adapter rodam no boot, sob advisory lock. Passa na mesma suíte de contrato do SQLite.
