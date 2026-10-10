# ADR 0081 — `create-zapforge-plugin`: scaffold sem dependências, template na forma curta e aceite por e2e

**Status:** Aceito (2026-10-10) · Detalha **D22** ([ADR 0022](0022-kit-de-autor.md)) · Usa a forma
curta do **D79** ([ADR 0079](0079-acucar-no-manifesto-do-plugin.md)) e os perfis do **D73**
([ADR 0073](0073-kit-de-testes-multiplataforma.md))

## Contexto

O D22 pôs um scaffold no kit de autor da v1 (#121). O aceite é que o projeto gerado instale,
builde e passe no teste de exemplo sem edição. A revisão multiplataforma (#265) pediu que o
template ensine o plugin portátil: `requires` mínimo, formatação pelos helpers neutros e teste em
mais de um perfil.

Três perguntas ficaram para decidir:

- **Como o scaffold é feito.** Perguntas interativas (`@clack/prompts`, `prompts`) somam
  dependências e um fluxo a testar. O template pode viver em strings no código, numa pasta do
  pacote ou num repositório baixado na hora (`degit`).
- **Que versão do core o projeto pede.** O core está em `0.0.0` e não está no npm. Ler a versão
  do core no build do scaffold o faria depender do core em runtime.
- **Como provar o aceite.** O teste unitário do gerador mostra os arquivos, não que eles
  instalam e buildam. O core e o kit ainda não estão no npm, então um `npm install` de verdade
  não resolve.

## Decisão

- **Pacote `create-zapforge-plugin`** (sem escopo, para `npm create zapforge-plugin`) em
  `packages/create-plugin`, com um binário e nenhuma dependência de runtime: `node:util`
  `parseArgs` e `node:fs`.
- **Um argumento, sem perguntas.** O nome do pacote npm, com escopo opcional. A pasta é o nome sem
  escopo; o `name` do manifesto, o nome sem escopo e sem o prefixo `zapforge-plugin-`; o export,
  o `name` em camelCase. O nome que o `definePlugin` recusaria e a pasta com arquivos são
  recusados antes de escrever. Os próximos passos saem no gerenciador que rodou o comando
  (`npm_config_user_agent`).
- **Template numa pasta `template/`** publicada com o `dist/`, com os marcadores `__package__`,
  `__name__` e `__export__`. Os marcadores são identificadores e strings válidos, então o código
  do template passa pelo Biome do workspace. O `_gitignore` vira `.gitignore`.
- **O exemplo é o plugin portátil na forma curta:** `!ola` em `commands`, reação conferida em
  `capabilities.has('reactions')`, resposta com `fmt` e `bold`, teste em
  `describe.each(PROFILE_NAMES)`. O projeto traz `tsconfig` strict com `isolatedDeclarations`,
  `tsdown` para o `dist/` e o changesets configurado.
- **Core como peer dependency e dev dependency, faixa `<1.0.0`** (também no `@zapforge/testing` e
  no `engine`). Um teste confere que a faixa aceita a versão atual do core e que `tsdown`,
  `typescript`, `vitest` e `@changesets/cli` têm as versões da raiz. Na 1.0, a faixa vira `^1.0.0`.
- **Aceite por e2e, fora do `pnpm test`.** `scripts/e2e.ts` empacota core, kit e scaffold com
  `pnpm pack`, gera o projeto pelo binário do tarball, aponta core e kit para os tarballs por
  `overrides` e roda `install`, `typecheck`, `test` e `build`. Roda no job `Scaffold` do CI,
  depois do `pnpm build`.

## Consequências

- Um plugin novo sai em um comando, já com teste nos quatro perfis, e o autor aprende o padrão
  portátil pelo exemplo.
- O e2e prova o que o autor vai rodar sobre os pacotes como sairiam no npm, inclusive o `files`
  do scaffold. Custa um job de CI com `pnpm build` e um `pnpm install` de ~110 pacotes.
- O teste do template fica fora do Vitest da raiz (`template/**` excluído): lá, os marcadores não
  resolvem.
- O `version` do manifesto não acompanha o `package.json` sozinho: o README do projeto avisa.
- Fica de fora: perguntas interativas, template em JavaScript, escolha de template (`--template`),
  `git init` e instalação automática. Entram por adição se os autores pedirem.
