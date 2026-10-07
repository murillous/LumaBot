# ADR 0041 — Reload de plugin em cascata pelos dependentes

**Status:** Aceito (2026-10-07) · Detalha **D17** ([ADR 0017](0017-config-por-plugin-zod.md)) e
**D18** ([ADR 0018](0018-service-registry.md))

## Contexto

Mudar a config de um plugin recarrega só ele (`teardown` → `dispose` → contexto novo → `setup`).
Quem depende dele costuma pegar o serviço no `setup` (`const ai = ctx.services.get('ai')`, como
ensina o [plano §6.7](../../ZAPFORGE_PLAN.md#67-services-entre-plugins)) e guarda a instância
antiga (#226). Depois do reload, essa instância usa o contexto descartado do provedor: `storage`,
`send` e `scheduler` rejeitam com `ContextExpiredError` ([ADR 0033](0033-cancelamento-cooperativo.md)),
e a config nova não chega a quem usa o serviço. Se o `setup` novo do provedor falha, o dependente
segue "carregado" com um serviço que já saiu do registry. No boot, a mesma situação o marcaria
`dependency-skipped`.

Com o dashboard (M5-4) mudando config em runtime, um ajuste no plugin `ai` quebraria `resumo`
(M5-2) e `spontaneous` (M5-3).

Só o serviço tem esse problema. Papéis custom são resolvidos por nome a cada checagem
([ADR 0035](0035-papeis-nomeados-por-plugin.md)), e `commands.list` e o barramento de eventos não
guardam referência de outro plugin.

Alternativas consideradas:

- **Proxy no `services.get`**, que resolve a implementação atual a cada chamada. Resolve a
  referência velha, mas não o provedor que falhou, e esconde a troca do dependente.
- **Só documentar** que o dependente chama `get` a cada uso. Contradiz o exemplo do plano e deixa
  o erro para o autor do plugin.

## Decisão

- `reload(x)` recarrega também quem depende de `x` por `dependsOn`, direta ou transitivamente.
  Os dependentes descem antes de `x`, na ordem inversa da carga; depois `x` e eles sobem, na ordem
  de carga.
- Os dependentes passam pela mesma avaliação do boot: se `x` não subiu, ficam
  `dependency-skipped`; se `x` sobe num reload seguinte, eles voltam. Um dependente ignorado por
  motivo próprio (desabilitado, engine, capability) continua ignorado. Um cujo `setup` tinha falhado
  ganha uma nova tentativa.
- `after` não entra na cascata: ele só ordena a carga, e quem o usa não pega nada do outro plugin.
  O vínculo de serviço é o `dependsOn`, que o ADR 0018 já exige de quem consome.
- `PluginReloadResult` ganha `dependents` (as linhas novas dos dependentes, na ordem de carga). Em
  `errors` entram as falhas de `teardown`/`dispose` de todo o subgrafo. O `Bot` emite
  `plugin.error` também para o `setup` falho de um dependente.

## Consequências

- Mudar a config de um provedor reinicia mais plugins. Durante o reload, comandos e listeners de
  todo o subgrafo ficam ausentes. Antes, só os do plugin recarregado ficavam.
- O dependente pode guardar o serviço no `setup` com segurança, como o plano ensina.
- Um consumidor sem `dependsOn` continua sujeito à referência velha, mas ele já não tinha garantia
  de ordem no boot. O `ServiceNotFoundError` já pede o `dependsOn`.
- O reload continua serializado com `start` e `stop` pela fila do host.
