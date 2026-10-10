---
'@zapforge/core': minor
'@zapforge/storage-sqlite': minor
---

Trava de sessão entre processos (ADR 0074). Dois processos com a mesma sessão sobre o mesmo banco
deixam de rodar juntos: o `start()` trava a sessão no storage e, com ela ocupada, espera até 30 s
(o tempo para vencer a trava de um processo que caiu) e rejeita com `BotConfigError` antes de
conectar. A trava é renovada a cada 10 s, liberada no `stop()`, e um bot que a perde para outro
processo para. O `StoragePort` ganha `acquireLease?`/`releaseLease?`, opcionais só para storage
de um processo (memória). A suíte de contrato as exige, a menos que se passe `processLocal: true`.
O `@zapforge/storage-sqlite` as implementa numa tabela nova (`leases`, schema 2), criada sozinha
no boot.
