# ADR 0002 — TypeScript no kernel, publicado com `.d.ts`

**Status:** Aceito (2026-10-06) · Decisão **D02** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O objetivo central é que a comunidade escreva plugins **sem ler o código interno**
([plano §1](../../ZAPFORGE_PLAN.md#1-visão)). O que permite isso é o contrato público: tipos,
autocompletar e erros de compilação que guiam o autor. O LumaBot é JavaScript puro,
e os contratos dele (`src/core/ports/*`) só existem por convenção.

Alternativas consideradas: JavaScript com JSDoc; JavaScript puro.

## Decisão

O kernel e os pacotes oficiais são escritos em **TypeScript** e publicados como
JavaScript + arquivos `.d.ts`. Plugins de terceiros podem ser escritos em TS ou JS.

## Consequências

- O contrato tipado é a DX: manifesto, contexto, eventos e services têm tipos
  verificáveis.
- Precisamos de uma etapa de build para publicação (ver [ADR 0026](0026-tooling.md)).
- Plugins em JS continuam funcionando, só sem a checagem estática.
