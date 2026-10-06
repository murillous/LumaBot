# CLAUDE.md

Monorepo do **ZapForge**, kernel de bot de mensageria extraído do LumaBot. Plano e roadmap:
`ZAPFORGE_PLAN.md`; o porquê de cada decisão (D01–D31): `docs/adr/`. Siga as decisões
registradas; para mudar uma, proponha um ADR novo que a substitua.

## Onde você está

- **Kernel** (`packages/*`, `plugins/*`, `apps/*`): pnpm workspace, TypeScript, Node 24+.
  Setup, comandos, layout de pacote, imports e regras do Biome estão no `README.md` — leia
  antes de criar ou mexer num pacote.
- **`legacy/`**: o LumaBot em produção até a paridade, fora do workspace (npm, JS). Antes de
  tocar nele, leia `legacy/CLAUDE.md` e rode os comandos (`npm ci`, `npx vitest run`) a partir
  de `legacy/`.

## Git

Branch a partir de `develop` e PR com `--base develop`: a `main` alimenta a produção do
legacy. Commits em Conventional Commits, descrição em PT-BR, com o ID do roadmap:
`feat(core): roteador de comandos (M1-2.1)`. `Closes #N` no commit ou PR de cada issue.

## Convenções

O Biome barra default export, `../`, `process.env` fora da config e `catch` vazio. Além dele:

- Comentários em PT-BR explicando o **porquê**; o óbvio fica sem comentário.
- Erro sempre tem destino: tratado, relançado ou registrado com fallback explícito.
- A menor solução que resolve: abstração e configuração só quando a tarefa atual exige.
- Plugins conversam com o core pela API pública (`@zapforge/*`). Se faltar algo, a lacuna é
  do core — resolva lá ([ADR 0029](docs/adr/0029-open-core-repo-privado.md)).

## Definição de pronto

Uma tarefa só está pronta com **todos** os itens:

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` verdes.
2. Testes novos para o comportamento novo. Testes existentes ficam intactos — se um parece
   errado, pergunte ao dono do repositório antes de alterar ou apagar.
3. Docs do COMO em `docs/` (do pacote ou da raiz), ADR em `docs/adr/` quando houve decisão
   arquitetural, e changeset (`pnpm changeset`) quando mudou um pacote publicável — o
   changelog sai dele.
4. Benchmark sem regressão > 10% (a partir do M2).
