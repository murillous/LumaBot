# ADR 0016 — Manifesto do plugin

**Status:** Aceito (2026-10-06) · Decisão **D16** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O kernel precisa decidir, antes de carregar um plugin, se ele é compatível com a
versão do core, com o transport e com os outros plugins.

Alternativas consideradas: fixar sempre o transporte no manifesto.

## Decisão

Todo plugin declara ([plano §6.2](../../ZAPFORGE_PLAN.md#62-definição-de-plugin-manifesto)):

- `name` e `version`;
- `engine` — range semver do `@zapforge/core`, **obrigatório**;
- `requires` — capabilities do transport;
- `transports` — opcional, fixa runner(s);
- `dependsOn` — outros plugins com range semver.

## Consequências

- Todos os transports falam a mesma API, então capability é mais precisa que fixar
  o runner; `transports` fica para casos como o escape hatch.
- O loader valida o manifesto no boot e monta a tabela de boot com o motivo de cada
  plugin não carregado.
