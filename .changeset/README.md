# Changesets

Todo PR que muda o comportamento de um pacote publicável (`packages/*`, `plugins/*`) leva um
changeset: rode `pnpm changeset`, escolha os pacotes e o tipo de bump (`0.x` livre até a 1.0) e
descreva a mudança para quem usa o pacote. O arquivo gerado aqui vai no mesmo PR.

`pnpm changeset version` consome os changesets, sobe as versões e escreve os `CHANGELOG.md`.
Pacotes `private` (ex.: `apps/*`) ficam de fora.
