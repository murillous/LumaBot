# CLAUDE.md

Repositório do **LumaBot**, o bot de WhatsApp da Luma. O kernel é o
[Bridger](https://github.com/murillous/usebridger) (`@usebridger/*`, consumido do npm): kernel,
plugins oficiais, roadmap e ADRs do kernel vivem lá. Se o app precisa de algo que o kernel não
tem, a lacuna é do Bridger — abra a issue no `usebridger`, não contorne aqui.

## Onde você está

- **`apps/lumabot`**: a Luma sobre o Bridger. pnpm workspace, TypeScript, Node 24+. Setup,
  comandos, imports e regras do Biome estão no `README.md`; como rodar, em
  `apps/lumabot/docs/README.md`.

## Git

Branch a partir de `develop` e PR com `--base develop`; a `main` é a versão estável.
Commits em Conventional Commits, descrição em PT-BR:
`feat(lumabot): comando de lembrete`. `Closes #N` no commit ou PR de cada issue.

## Convenções

O Biome barra default export, `../`, `process.env` fora da config e `catch` vazio. Além dele:

- Comentários em PT-BR explicando o **porquê**; o óbvio fica sem comentário.
- Erro sempre tem destino: tratado, relançado ou registrado com fallback explícito.
- A menor solução que resolve: abstração e configuração só quando a tarefa atual exige.
- O app usa só a API pública do Bridger.

## Definição de pronto

Uma tarefa só está pronta com **todos** os itens:

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` verdes.
2. Testes novos para o comportamento novo. Testes existentes ficam intactos — se um parece
   errado, pergunte ao dono do repositório antes de alterar ou apagar.
3. Docs do COMO em `apps/lumabot/docs/`, e ADR em `docs/adr/` quando houve decisão
   arquitetural.
