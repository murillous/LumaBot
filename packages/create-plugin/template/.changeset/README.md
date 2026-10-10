# Changesets

Cada mudança que quem usa o plugin precisa saber leva um changeset: rode `npm run changeset`,
escolha o tipo de bump e descreva a mudança. O arquivo gerado aqui vai no mesmo commit.

Na hora de publicar, `npx changeset version` sobe a versão e escreve o `CHANGELOG.md`, e
`npm run build && npx changeset publish` publica no npm.
