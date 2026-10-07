---
'@zapforge/core': patch
---

`CORE_VERSION` deixa de ser mantida à mão: `pnpm version-packages` roda o `changeset version` e
reescreve a constante com a versão nova do `package.json`, para o PR de versão não sair com o
`engine` conferido contra a versão antiga. A doc de plugins passa a dizer qual `engine` declarar
durante o 0.x (`>=0.1.0 <1.0.0` no monorepo, `^0.M.0` fora dele) e por que `^0.0.x` quebra no
primeiro bump.
