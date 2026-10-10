# create-zapforge-plugin — documentação

Cria a pasta de um plugin do ZapForge pronta para desenvolver, testar e publicar. O porquê das
escolhas está no [ADR 0081](../../../docs/adr/0081-create-zapforge-plugin.md).

## Uso

```sh
npm create zapforge-plugin@latest zapforge-plugin-ola
pnpm create zapforge-plugin @acme/zapforge-plugin-ola
```

O único argumento é o nome do pacote npm, com escopo opcional. Dele saem:

| | `@acme/zapforge-plugin-boas-vindas` |
| --- | --- |
| Pasta criada | `zapforge-plugin-boas-vindas/` (sem o escopo) |
| `name` do manifesto | `boas-vindas` (sem o escopo e sem o prefixo `zapforge-plugin-`) |
| Export | `boasVindas` |

O `name` do manifesto segue a regra do `definePlugin` (kebab-case começando por letra), e o
scaffold recusa o nome que não serve antes de criar qualquer arquivo. Também recusa uma pasta que
já existe com arquivos. Não há perguntas nem opções além de `--help`: o resto se edita no projeto.

No fim, mostra os próximos passos no gerenciador que rodou o comando (`npm`, `pnpm`, `yarn` ou
`bun`).

## O que é gerado

```
zapforge-plugin-ola/
  src/index.ts          # o plugin, na forma curta (commands no manifesto)
  src/index.test.ts     # teste com @zapforge/testing nos quatro perfis
  package.json          # core como peer dependency; build, test, typecheck, changeset
  tsconfig.json         # strict + isolatedDeclarations
  tsdown.config.ts      # dist/ com JS e .d.ts
  README.md
  .changeset/           # config do changesets para versão e changelog
  .gitignore
```

O exemplo responde `!ola` e ensina o plugin portátil:

- **`requires` só com o essencial.** `commands` já implica `send.text`; a reação é conferida em
  runtime (`capabilities.has('reactions')`), então o plugin roda também no chat web, que não tem.
- **Formatação pelos helpers.** `fmt` e `bold`, nunca `*negrito*` à mão.
- **Teste em todos os perfis.** `describe.each(PROFILE_NAMES)` roda o mesmo teste como WhatsApp,
  Telegram, Discord e web.

O `@zapforge/core` entra como peer dependency (o plugin usa o core do bot) e como dev dependency
(para o teste e o typecheck). A faixa é `<1.0.0` até o core chegar ao 1.0.

## Manter o template

O template fica em `template/`, publicado junto com o `dist/`. Os marcadores `__package__`,
`__name__` e `__export__` são trocados em todos os arquivos; o `_gitignore` vira `.gitignore`
(o npm tira `.gitignore` do pacote publicado). O código do template é TypeScript válido, então o
Biome do workspace o confere; o teste dele fica fora do Vitest da raiz e roda só no e2e.

Dois testes avisam quando o template fica para trás: as versões de `tsdown`, `typescript`,
`vitest` e `@changesets/cli` têm que ser as da raiz, e a faixa do core tem que aceitar a versão
atual dele.

### E2E

O aceite (o projeto gerado instala, builda e passa no teste sem edição) é conferido pelo e2e:

```sh
pnpm build
pnpm --filter create-zapforge-plugin e2e
```

Ele empacota o `@zapforge/core`, o `@zapforge/testing` e o próprio scaffold com `pnpm pack`, gera
o projeto pelo binário do tarball numa pasta temporária, aponta o core e o kit para os tarballs
(`overrides`, enquanto não estão no npm) e roda `pnpm install`, `typecheck`, `test` e `build`. No
CI, é o job `Scaffold`.
