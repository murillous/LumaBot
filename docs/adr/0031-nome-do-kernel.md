# ADR 0031 — Nome do kernel

**Status:** Substituído por [ADR 0083](0083-nome-bridger.md) (2026-10-10) · Decisão **D31** do
[plano](../../BRIDGER_PLAN.md#4-decisões)

## Contexto

O kernel precisava de um nome para os pacotes npm e para o repositório. O primeiro
candidato, `zapcore`, conflita com `go.uber.org/zap/zapcore`, conhecido no
ecossistema Go.

## Decisão

O primeiro nome escolhido fazia referência ao WhatsApp, com escopo próprio no npm. O kernel e
os plugins públicos ficam no GitHub sob a conta pessoal `murillous`; os plugins privados ficam
na `thera-org` (ver [ADR 0029](0029-open-core-repo-privado.md)).

## Consequências

- Com Discord, Telegram e sistemas web como alvos, um nome ligado ao WhatsApp sugere uma
  plataforma só. O [ADR 0083](0083-nome-bridger.md) troca o nome antes do primeiro publish.
