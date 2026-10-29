# LumaBot

Bot de WhatsApp com a **Luma**, assistente virtual com personalidade, escrito sobre o
[Bridger](https://github.com/murillous/usebridger) (`@usebridger/*` no npm). O app só compõe o
bot e os plugins da Luma; o kernel, os plugins oficiais e o roadmap vivem no `usebridger`, e bug
ou feature do Bridger vai para lá.

Como rodar, configurar e o que cada plugin faz: [`docs/README.md`](docs/README.md).

## Desenvolvimento

Node 24+ (`.nvmrc`) e pnpm (versão em `packageManager`; com `corepack enable`, basta
`pnpm install`).

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Roda o `.ts` direto, sem build |
| `pnpm build` / `pnpm start` | `tsdown` para `dist/` e roda o build |
| `pnpm lint` / `pnpm lint:fix` | Biome: lint, formatação e organização de imports |
| `pnpm typecheck` | `tsc`, só checagem de tipos |
| `pnpm test` | Vitest |

O CI ([`ci.yml`](.github/workflows/ci.yml)) roda lint, typecheck, testes e build em todo push e
PR para `main`/`develop`.

### Convenções

- TypeScript strict e ESM. Em dev o Node executa o `.ts` direto, então só vale sintaxe apagável
  (sem `enum`, `namespace`, parameter properties) e os imports levam a extensão `.ts`.
- Import relativo só para a mesma pasta ou abaixo; para subir, o alias `#` do `package.json`
  (`import { loadConfig } from '#config.ts'`).
- O Biome barra `export default` (exceto em `*.config.ts`), `../`, `process.env` fora de
  `src/config.ts` e `catch` sem instrução ([`biome/`](biome/no-swallowed-catch.grit)).

## Licença

[Apache-2.0](LICENSE).
