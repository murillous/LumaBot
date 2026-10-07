---
'@zapforge/core': minor
---

Recarregar um plugin que provê serviço não quebra mais quem depende dele (#226, ADR 0041).
`host.reload(x)` (e o reload por `config.setOverrides`) recarrega em cascata os plugins que
declaram `dependsOn` em `x`, direta ou transitivamente. Eles descem antes de `x`, sobem depois e
são reavaliados como no boot: se o `setup` novo de `x` falhar, ficam `dependency-skipped`.
`PluginReloadResult` ganha `dependents`, e o `Bot` emite `plugin.error` também para o `setup`
falho de um dependente.
