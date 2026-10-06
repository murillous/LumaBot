# ADR 0004 — Uma sessão por processo, zero estado global

**Status:** Aceito (2026-10-06) · Decisão **D04** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O LumaBot tem estado global estático por toda parte: `DatabaseService.*` em 11
arquivos, `SpontaneousHandler static #cooldowns`, `MessageHandler.#pm`, e
`Database.js` abre o banco no import. Isso impede testes isolados, impede duas
instâncias no mesmo processo e torna os side effects de import imprevisíveis.

Alternativas consideradas: multi-sessão nativa no kernel.

## Decisão

Cada processo roda **uma sessão** (um número). Todo estado fica pendurado na
instância `Bot`; nenhum módulo tem side effect em import (abrir banco, ler env,
criar diretório).

## Consequências

- Para escalar, sobem mais processos.
- Multi-sessão futura = instanciar `Bot` duas vezes; o aceite do M1-1 testa que duas
  instâncias no mesmo processo não compartilham estado.
- Exige disciplina: singletons e caches de módulo ficam proibidos no core e nos
  plugins oficiais.
