# ADR 0026 — Tooling: Node 24, pnpm, tsdown, Vitest, Biome

**Status:** Aceito (2026-10-06) · Decisão **D26** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O monorepo precisa de runtime, gerenciador de pacotes, build, testes e lint. O
LumaBot usa Node 20, npm, Vitest e nenhum lint, e o diagnóstico registra 155
imports relativos, `export default` e `catch {}` vazio.

Alternativas consideradas: Node 18/20/22; tsup (em manutenção); ESLint + Prettier.

## Decisão

- **Node 24 LTS+** (`engines: { node: ">=24" }`, `.nvmrc`).
- **pnpm** workspaces.
- TS executado direto no Node em dev; **tsdown** para publicar (JS + `.d.ts`).
- **Vitest** com config de workspace.
- **Biome** com as regras do projeto: sem default export, sem `catch` vazio, sem
  imports relativos ascendentes, sem `process.env` fora da config.

## Consequências

- LTS mais longo.
- O pnpm estrito evita dependência fantasma nos plugins.
- O Biome é uma ferramenta só, rápida; algumas regras são plugins GritQL próprios
  (`tooling/biome/`).
- O `legacy/` continua em Node 20 + npm até ser removido.
