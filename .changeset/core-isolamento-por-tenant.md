---
'@zapforge/core': minor
---

Isolamento automático por tenant (ADR 0072): o transport marca o cliente verificado em
`chat.tenantId`, e o mesmo `ctx.storage` do plugin passa a gravar no namespace daquele tenant em
toda mensagem ou evento do chat. Isso inclui a closure do `setup`, o service de outro plugin
chamado pelo handler e o job agendado nele, que guarda o tenant de origem. Sem tenant, vale o
escopo da sessão, como antes. `ctx.storage.forTenant(id)` escolhe um tenant à mão (setup, job,
plugin de administração). Mudança aditiva. O storage passa a recusar `@` no nome do plugin, que
já não aparece em nomes kebab-case válidos.
