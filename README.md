# Bridger

Kernel de bot de mensageria extensível por plugins — em construção.
Plano, decisões e marcos: [`BRIDGER_PLAN.md`](BRIDGER_PLAN.md).
O porquê de cada decisão (`DNN` no plano, `ADR 00NN`) está nos ADRs em [`docs/adr/`](docs/adr/README.md).
Para escrever um plugin, comece pelos [guias do autor](docs/guias/README.md).

O LumaBot atual (em produção até a paridade) vive em [`legacy/`](legacy/README.md); a versão
sobre o kernel, em [`apps/lumabot/`](apps/lumabot/docs/README.md).

Quer contribuir? Veja o [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Desenvolvimento

Monorepo pnpm (`packages/*`, `plugins/*`, `apps/*`, `bench/` e `tooling/typedoc/`). A versão do
pnpm vem de `packageManager` no `package.json` — com `corepack enable`, basta rodar
`pnpm install` na raiz.
O `legacy/` fica fora do workspace e continua usando npm.

Requer Node 24+ (`engines` na raiz; `.nvmrc` para `nvm use`/`fnm use`).

### Comandos (na raiz)

| Comando | O que faz |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | Biome: lint + formatação + organização de imports |
| `pnpm typecheck` | `tsc -b` em todos os pacotes (project references) |
| `pnpm test` | Vitest em todos os pacotes |
| `pnpm build` | `tsdown` em cada pacote (ESM + `.d.ts` em `dist/`) e a referência da API |
| `pnpm run docs` | Só a referência da API: TypeDoc sobre as entradas públicas, em `docs/referencia/` ([`tooling/typedoc/`](tooling/typedoc/docs/README.md)). O `run` é obrigatório: no pnpm 12, `pnpm docs` é um comando nativo que abre a página de um pacote do registry |
| `pnpm bench` | Build e benchmark das metas de performance ([`bench/`](bench/docs/README.md)) |
| `pnpm changeset` | Registra a mudança de um pacote publicável |
| `pnpm version-packages` | Consome os changesets (versões e changelogs) e sincroniza o `CORE_VERSION` |
| `pnpm check:packages` | Confere os pacotes publicáveis depois do build: publint no tarball e metadados do publish |
| `pnpm release` | Build e `changeset publish`; quem roda é o workflow de release ([`docs/release.md`](docs/release.md)) |

### Novo pacote

```
packages/<nome>/
  package.json
  tsconfig.json
  src/index.ts
```

`package.json`:

```json
{
  "name": "@usebridger/<nome>",
  "version": "0.0.0",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/murillous/usebridger.git",
    "directory": "packages/<nome>"
  },
  "type": "module",
  "imports": { "#*": "./src/*" },
  "exports": {
    ".": {
      "@usebridger/source": "./src/index.ts",
      "types": "./dist/index.d.mts",
      "default": "./dist/index.mjs"
    }
  },
  "files": ["dist"],
  "scripts": { "build": "tsdown" },
  "publishConfig": { "access": "public" }
}
```

`tsconfig.json` (em `references`, os pacotes `@usebridger/*` de que este depende):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": ".tsbuild" },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

E adicione o pacote em `references` no `tsconfig.json` da raiz. Testes (`*.test.ts`) ficam
ao lado do código em `src/`; o Vitest descobre o pacote sozinho.

### TypeScript

`tsconfig.base.json`: strict, ESM, `nodenext`. Em dev o Node executa o `.ts` direto, então:

- só vale sintaxe apagável (`erasableSyntaxOnly` — sem `enum`, `namespace`, parameter properties);
- imports levam a extensão `.ts` (`import { x } from './x.ts'`);
- a API exportada tem tipos explícitos (`isolatedDeclarations`), o que permite ao tsdown gerar
  os `.d.ts` sem rodar o compilador.

O `tsc` só checa tipos; o JS publicado sai do tsdown, com as dependências fora do bundle.

### Imports

- **Entre pacotes**: pelo nome (`import { … } from '@usebridger/core'`), com a dependência
  `"@usebridger/core": "workspace:^"` (no publish vira `^<versão>`) — sem `paths` no tsconfig. A condição `@usebridger/source`
  nos `exports` aponta para o fonte: TypeScript (`customConditions`) e Vitest já a usam, e
  para rodar sem build use `node --conditions=@usebridger/source src/main.ts`. Fora dela, o
  pacote resolve para `dist/`.
- **Dentro do pacote**: relativo só para a mesma pasta ou abaixo (`./sub/x.ts`). Para subir
  de pasta, use o alias do próprio pacote (`import { env } from '#config/env.ts'`, via
  `imports` no `package.json`) — o Biome barra `../`.

### Regras do Biome

Além do preset recomendado, viram erro: `export default` (exceto em `*.config.ts`), import
relativo ascendente, `process.env` fora da camada de config (`src/config.ts` ou `src/config/`)
e `catch` sem nenhuma instrução — inclusive só com comentário (plugin em
[`tooling/biome/`](tooling/biome/no-swallowed-catch.grit)).

### Changesets

PR que muda um pacote publicável leva um changeset (`pnpm changeset`) — ver
[`.changeset/README.md`](.changeset/README.md). O workflow de release transforma os changesets
de `develop` num PR de versão e publica no npm depois do merge dele: fluxo, segredos e como
reverter em [`docs/release.md`](docs/release.md).

### CI

Todo push e PR para `main`/`develop` roda dois workflows:

- [`ci.yml`](.github/workflows/ci.yml) — kernel: jobs `Lint`, `Typecheck`, `Testes` e `Build`
  (os mesmos comandos da tabela acima), com o store do pnpm em cache. O job `Scaffold` gera um
  plugin com o `create-bridger-plugin` e confere que ele instala, testa e builda
  ([e2e](packages/create-plugin/docs/README.md#e2e)). O job `Testes` sobe um
  Postgres em container para o `@usebridger/storage-postgres`. O job `Benchmark` mede as metas
  de performance e falha com piora > 10% sobre o baseline do commit-base, medido no mesmo
  runner ([ADR 0054](docs/adr/0054-baseline-do-benchmark.md)). O job `Pacotes` builda e roda o
  `pnpm check:packages`, para um pacote que não publicaria quebrar no PR e não no release.
- [`legacy-ci.yml`](.github/workflows/legacy-ci.yml) — suíte do `legacy/`, sem alteração.

O setup comum (Node do `.nvmrc`, pnpm do `packageManager`, `pnpm install --frozen-lockfile`)
fica em [`.github/actions/setup`](.github/actions/setup/action.yml).

O push em `develop` também roda o [`release.yml`](.github/workflows/release.yml), que abre o PR
de versão ou publica os pacotes ([`docs/release.md`](docs/release.md),
[ADR 0082](docs/adr/0082-release-a-partir-de-develop.md)).

## Licença

[Apache-2.0](LICENSE) para `packages/*`, `plugins/*` e `apps/*` ([ADR 0028](docs/adr/0028-licenca-apache-2.md)).
O `legacy/` continua sob [MIT](legacy/LICENSE).
