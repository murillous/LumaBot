# ZapForge

Kernel de bot de mensageria extensível por plugins — em construção.
Plano, decisões e marcos: [`ZAPFORGE_PLAN.md`](ZAPFORGE_PLAN.md).

O LumaBot atual (em produção até a paridade) vive em [`legacy/`](legacy/README.md).

## Desenvolvimento

Monorepo pnpm (`packages/*`, `plugins/*`, `apps/*`). A versão do pnpm vem de
`packageManager` no `package.json` — com `corepack enable`, basta rodar `pnpm install` na raiz.
O `legacy/` fica fora do workspace e continua usando npm.

Requer Node 24+ (`engines` na raiz; `.nvmrc` para `nvm use`/`fnm use`).

### TypeScript

- `tsconfig.base.json`: strict, ESM, `module`/`moduleResolution` `nodenext`. Em dev o Node
  executa o `.ts` direto, então só vale sintaxe apagável (`erasableSyntaxOnly`) e imports
  relativos levam extensão `.ts` (reescrita para `.js` na emissão).
- Project references: cada pacote tem seu `tsconfig.json` estendendo a base e listando em
  `references` os pacotes `@zapforge/*` de que depende; o `tsconfig.json` da raiz referencia
  todos os pacotes. `pnpm typecheck` roda `tsc -b` na raiz.

Exemplo de `packages/<nome>/tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

### Aliases `@zapforge/*`

Pacotes se importam pelo nome (`import { … } from '@zapforge/core'`), declarando a
dependência como `"@zapforge/core": "workspace:*"` — sem `paths` no tsconfig. Cada pacote
expõe o fonte sob a condição `@zapforge/source` e o build no resto:

```json
"exports": {
  ".": {
    "@zapforge/source": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

O TypeScript já resolve essa condição (`customConditions` na base). Para rodar o fonte
direto no Node, sem build: `node --conditions=@zapforge/source src/main.ts`. Publicado, o
pacote cai em `dist/`.
