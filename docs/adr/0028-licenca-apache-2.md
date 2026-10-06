# ADR 0028 — Licença Apache-2.0

**Status:** Aceito (2026-10-06) · Decisão **D28** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O kernel será usado comercialmente (o nosso uso e o de terceiros) e precisa de uma
licença permissiva, com segurança jurídica para empresas. O LumaBot é MIT.

Alternativas consideradas: MIT; AGPL com licenciamento dual.

## Decisão

O core, os plugins públicos e os apps usam **Apache-2.0**. O `legacy/` continua
**MIT**.

## Consequências

- A Apache-2.0 traz concessão explícita de patentes, adequada a uso comercial.
- `LICENSE` Apache-2.0 na raiz e `legacy/LICENSE` MIT (M0-6).
- Contribuições externas entram sob Apache-2.0.
