# ADR 0027 — Releases com Changesets

**Status:** Aceito (2026-10-06) · Decisão **D27** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Plugins da comunidade vão depender de `engine: '^1.0.0'`. Sem um processo claro de
versionamento e depreciação, uma minor do core pode quebrar o ecossistema.

Alternativas consideradas: versionamento manual.

## Decisão

Releases com **Changesets**, com changelog por pacote. Na `0.x` a API é livre. Após a
1.0, uma remoção só acontece depois de um ciclo `@deprecated` de pelo menos 1 minor.
APIs novas podem nascer `@experimental`.

## Consequências

- Cada PR que muda um pacote publicável traz um changeset.
- Compromisso de estabilidade público a partir da 1.0.
