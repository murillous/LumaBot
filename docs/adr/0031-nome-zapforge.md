# ADR 0031 — Nome: ZapForge

**Status:** Aceito (2026-10-06) · Decisão **D31** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O kernel precisava de um nome para os pacotes npm e para o repositório. O primeiro
candidato, `zapcore`, conflita com `go.uber.org/zap/zapcore`, conhecido no
ecossistema Go.

Alternativas consideradas: zapcore.

## Decisão

O projeto se chama **ZapForge**, com pacotes no escopo `@zapforge/*`. A org `zapforge`
foi criada no npm em 2026-10-06. O kernel e os plugins públicos ficam no GitHub sob
a conta pessoal `murillous`; os plugins privados ficam na `thera-org` (ver
[ADR 0029](0029-open-core-repo-privado.md)).

## Consequências

- Nome sem conflito conhecido; "Forge" ecoa a analogia dos mods de Minecraft.
- Aliases de import `@zapforge/*` no monorepo (M0-1).
