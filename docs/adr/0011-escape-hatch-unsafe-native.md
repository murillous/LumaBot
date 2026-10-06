# ADR 0011 — Escape hatch `ctx.unsafe.native`

**Status:** Aceito (2026-10-06) · Decisão **D11** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Nenhuma API normalizada cobre tudo no primeiro dia. Se o plugin não tiver nenhuma
saída, a comunidade fica travada esperando o core; se o socket for exposto
normalmente, voltamos ao vazamento do LumaBot.

Alternativas consideradas: não expor; expor normalmente.

## Decisão

`ctx.unsafe.native` dá acesso ao objeto nativo do transport, tipado como `unknown`,
e loga um aviso quando é usado. Usar o escape hatch implica `transports: ['baileys']`
(ou o transport correspondente).

## Consequências

- A comunidade não trava esperando o core.
- O uso medido indica o que vale promover a API oficial.
- Plugins que usam o escape hatch perdem a portabilidade entre transports, e isso fica
  explícito no manifesto.
