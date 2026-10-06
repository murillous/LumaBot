# ADR 0029 — Open core com repo privado

**Status:** Aceito (2026-10-06) · Decisão **D29** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Parte do valor comercial (transports Cloud API/Twilio/Zenvia, dashboard
multi-número, integrações com CRM) não será pública. Pastas privadas dentro do
monorepo público dariam tentação de usar internals do core.

Alternativas consideradas: pastas privadas no monorepo.

## Decisão

Plugins e transports comerciais vivem num **repo privado** na org `thera-org` do
GitHub, publicados como pacotes privados na org npm da Thera, consumindo os pacotes
**públicos** `@zapforge/*`.

## Consequências

- O repo privado é o teste definitivo da API pública: se ele precisar de algo não
  exportado, falta API no core — nunca atalho interno.
- Mudanças no core que o privado precisa passam por release pública.
