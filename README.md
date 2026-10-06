# ZapForge

Kernel de bot de mensageria extensível por plugins — em construção.
Plano, decisões e marcos: [`ZAPFORGE_PLAN.md`](ZAPFORGE_PLAN.md).

O LumaBot atual (em produção até a paridade) vive em [`legacy/`](legacy/README.md).

## Desenvolvimento

Monorepo pnpm (`packages/*`, `plugins/*`, `apps/*`). A versão do pnpm vem de
`packageManager` no `package.json` — com `corepack enable`, basta rodar `pnpm install` na raiz.
O `legacy/` fica fora do workspace e continua usando npm.
