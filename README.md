# LumaBot

Bot de WhatsApp com a **Luma**, assistente virtual com personalidade.

O repositório tem duas versões do bot:

- [`legacy/`](legacy/README.md) — o LumaBot em produção até a paridade (JavaScript, npm).
- [`apps/lumabot/`](apps/lumabot/docs/README.md) — a nova versão, escrita sobre o
  [Bridger](https://github.com/murillous/usebridger), o kernel de bot de mensageria extraído
  daqui e publicado no npm como `@usebridger/*`. As features do legacy chegam aos poucos, como
  plugins.

O kernel, os plugins oficiais, o roadmap e os ADRs vivem no
[`usebridger`](https://github.com/murillous/usebridger). Bug ou feature do Bridger vai para lá.

Quer contribuir? Veja o [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Desenvolvimento

Workspace pnpm com `apps/*`. A versão do pnpm vem de `packageManager` no `package.json` — com
`corepack enable`, basta rodar `pnpm install` na raiz. O `legacy/` fica fora do workspace e
continua usando npm.

Requer Node 24+ (`engines` na raiz; `.nvmrc` para `nvm use`/`fnm use`).

### Comandos (na raiz)

| Comando | O que faz |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | Biome: lint + formatação + organização de imports |
| `pnpm typecheck` | `tsc -b` em todos os apps (project references) |
| `pnpm test` | Vitest em todos os apps |
| `pnpm build` | `tsdown` em cada app (`dist/`) |

Como rodar o bot: [`apps/lumabot/docs/README.md`](apps/lumabot/docs/README.md).

### Bridger

Os pacotes `@usebridger/*` entram como dependência comum do npm, com a faixa de versão no
`package.json` do app. Para atualizar, suba a faixa e rode `pnpm install`; o changelog de cada
pacote está no [`usebridger`](https://github.com/murillous/usebridger).

### TypeScript

`tsconfig.base.json`: strict, ESM, `nodenext`. Em dev o Node executa o `.ts` direto, então:

- só vale sintaxe apagável (`erasableSyntaxOnly` — sem `enum`, `namespace`, parameter properties);
- imports levam a extensão `.ts` (`import { x } from './x.ts'`).

O `tsc` só checa tipos; o JS sai do tsdown.

### Imports

Relativo só para a mesma pasta ou abaixo (`./sub/x.ts`). Para subir de pasta, use o alias do
próprio app (`import { loadConfig } from '#config.ts'`, via `imports` no `package.json`) — o
Biome barra `../`.

### Regras do Biome

Além do preset recomendado, viram erro: `export default` (exceto em `*.config.ts`), import
relativo ascendente, `process.env` fora da camada de config (`src/config.ts` ou `src/config/`)
e `catch` sem nenhuma instrução — inclusive só com comentário (plugin em
[`biome/`](biome/no-swallowed-catch.grit)).

### CI

Todo push e PR para `main`/`develop` roda dois workflows:

- [`ci.yml`](.github/workflows/ci.yml) — workspace: jobs `Lint`, `Typecheck`, `Testes` e `Build`
  (os comandos da tabela acima), com o store do pnpm em cache. O setup comum (Node do `.nvmrc`,
  pnpm do `packageManager`, `pnpm install --frozen-lockfile`) fica em
  [`.github/actions/setup`](.github/actions/setup/action.yml).
- [`legacy-ci.yml`](.github/workflows/legacy-ci.yml) — suíte do `legacy/`.

O deploy de produção ([`deploy-ec2.yml`](.github/workflows/deploy-ec2.yml)) publica o `legacy/`.

## Licença

[Apache-2.0](LICENSE) para `apps/*`. O `legacy/` continua sob [MIT](legacy/LICENSE).
