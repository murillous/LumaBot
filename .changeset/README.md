# Changesets

Todo PR que muda o comportamento de um pacote publicável (`packages/*`, `plugins/*`) leva um
changeset: rode `pnpm changeset`, escolha os pacotes e o tipo de bump (`0.x` livre até a 1.0) e
descreva a mudança para quem usa o pacote. O arquivo gerado aqui vai no mesmo PR.

`pnpm version-packages` consome os changesets, sobe as versões e escreve os `CHANGELOG.md`
(`changeset version`), e depois sincroniza o `CORE_VERSION` do `@zapforge/core` com o
`package.json` novo. Use ele, e não o `changeset version` direto: sem a sincronização o
`version.test.ts` do core fica vermelho.
Pacotes `private` (ex.: `apps/*`) ficam de fora.
