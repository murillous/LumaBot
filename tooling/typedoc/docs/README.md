# Referência da API (TypeDoc)

Gera a referência HTML das entradas públicas dos pacotes `@zapforge/*` em `docs/referencia/`
(fora do git). Roda no `pnpm build` da raiz, como qualquer pacote do workspace, e sozinha com
`pnpm docs`. Abra `docs/referencia/index.html` no navegador.

## O que entra

Cada subpath dos `exports` com a condição `@zapforge/source` vira um módulo com o nome do import
(`@zapforge/core/adapter`, `@zapforge/testing/bot`). Internos do core (host, barramento, filas)
não aparecem: o TypeDoc parte só das entradas listadas em `typedoc.json`. O texto de cada símbolo
vem do TSDoc no código.

O `create-zapforge-plugin` fica de fora: é um binário, sem API importável.

## Novo pacote ou novo export

Acrescente o arquivo de fonte do export em `entryPoints` no `typedoc.json`. O plugin local
`module-names.js` compara essa lista com os `exports` dos `package.json`: export sem entrada ou
entrada sem export vira warning, e o `treatWarningsAsErrors` faz o build falhar até as duas
baterem.

## Por que TypeScript 6 aqui

O repositório usa o TypeScript 7, cuja API de compilador ainda é experimental; o TypeDoc 0.28
depende da API do 6 e aceita no máximo o 6.0 (peer dependency). Por isso este pacote fixa `typescript@6.0.3` só para
ele: a checagem de tipos e o build dos pacotes seguem no 7. Quando o TypeDoc suportar o 7, basta
remover a dependência daqui.
