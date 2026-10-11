# ADR 0082 — Release a partir de `develop`, com Trusted Publishing no npm e PR de versão aberto por um GitHub App

**Status:** Aceito (2026-10-10) · Detalha **D27** ([ADR 0027](0027-releases-changesets.md)) · Usa a
org `usebridger` do **D83** ([ADR 0083](0083-nome-bridger.md)) e atende o **D29**
([ADR 0029](0029-open-core-repo-privado.md))

## Contexto

O D27 escolheu os Changesets, mas nada versionava nem publicava os pacotes `@usebridger/*` (#246).
O `create-bridger-plugin` (M3-3), o guia do primeiro plugin (M3-4) e o repo privado da
`thera-org` (D29) instalam o core do npm. Deixar a primeira publicação para a 1.0.0 (V1-3) seria
publicar sem nenhum `0.x` exercitado.

Três perguntas ficaram para decidir:

- **De qual branch sai o release.** A `main` alimenta a produção do `legacy/`; o kernel vive em
  `develop`, que já é a `baseBranch` do `.changeset/config.json`.
- **Como o CI se autentica no npm.** Um token de longa duração no repositório vaza e expira. O
  Trusted Publishing (OIDC) dispensa o token e gera provenance, mas não cria pacote novo: só
  publica num pacote que já existe e tem o repositório configurado como publicador confiável.
- **Com que token o PR de versão é aberto.** Um PR aberto com o `GITHUB_TOKEN` não dispara outros
  workflows: o PR de versão ficaria sem os checks do `ci.yml`.

## Decisão

- **Release a partir de `develop`**, pelo `release.yml` com `changesets/action@v2`. Com changesets
  pendentes, o push abre ou atualiza o PR de versão `chore(release): versão dos pacotes`, gerado
  pelo `pnpm version-packages` (nunca o `changeset version` direto, que deixaria o `CORE_VERSION`
  para trás). Sem changesets, ou seja no merge do PR de versão, publica com `pnpm release`
  (`pnpm build && changeset publish`) e cria as tags `<pacote>@<versão>`, sem GitHub Release.
- **Gate no mesmo job:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` e
  `pnpm check:packages` rodam antes da action, no commit exato que vira PR ou publish. A
  `concurrency` não cancela execução em andamento: um publish nunca é cortado.
- **npm por Trusted Publishing**, com `id-token: write` e provenance
  (`PNPM_CONFIG_PROVENANCE=true`). O primeiro publish de cada pacote sai pelo mesmo workflow com
  um secret `NPM_TOKEN` granular e temporário (só publish, só `@usebridger/*` e
  `create-bridger-plugin`); depois de configurar o publicador confiável em cada pacote, o secret
  é apagado.
- **PR de versão aberto por um GitHub App** do dono do repositório (`RELEASE_APP_ID` em
  variável, `RELEASE_APP_PRIVATE_KEY` em secret), com o token de curta duração do
  `actions/create-github-app-token`. O App também cria commits e tags pela API.
- **Pacote pronto para publicar**, conferido no CI pelo `pnpm check:packages`: publint no tarball,
  `license`, `repository` com `directory` (a provenance recusa repositório divergente),
  `publishConfig.access: public` e dependências internas em `workspace:^`.

## Consequências

- Nada sai para o npm sem gate verde no commit publicado, e o PR de versão passa pelo `ci.yml`
  como qualquer PR.
- Em regime, não há token de npm no repositório. O bootstrap de um pacote novo exige criar o
  `NPM_TOKEN`, publicar, configurar o Trusted Publishing e apagar o secret
  ([`docs/release.md`](../release.md)).
- O App é mais uma peça a manter, mas não expira como um PAT e o PR de versão não sai em nome do
  dono, que pode revisá-lo.
- `main` e `develop` divergem por design: o release do kernel não espera o merge na `main`.
- Snapshot/canary, GitHub Packages para a `thera-org` e a 1.0.0 ficam para quando uma tarefa
  pedir.
