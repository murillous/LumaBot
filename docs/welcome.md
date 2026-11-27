# Plugin `welcome`

Boas-vindas no privado: na primeira mensagem de cada pessoa, a Luma se apresenta e manda o menu
de comandos, o mesmo do `!help`. Código em `src/plugins/welcome/`. Depende do
[`help`](help.md) (`dependsOn: { help: '^1.0.0' }`), de onde vem o menu.

## Quando apresenta

| Situação | O que acontece |
| --- | --- |
| Primeira mensagem da pessoa no privado | Uma mensagem só: a apresentação (`messages.intro`) e o menu, citando a mensagem dela. A Luma responde ao que foi dito logo depois, como sempre |
| A pessoa começa por um comando (`!s`, `!menu`...) | O comando roda e a pessoa é marcada sem apresentação: quem começa por comando já sabe usar a Luma |
| Mensagens seguintes | Nada |
| Grupo | Nada: uma apresentação por pessoa nova viraria spam |
| Mensagem de outro bot | Ignorada; não marca |

A marca fica no storage do plugin (`welcomed:<pessoa>`), pelo `personId`: a mesma pessoa por
LID ou por número conta uma vez. Ela é gravada antes do envio; se o envio falhar
(`welcome.failed` no log), a pessoa fica sem a apresentação, mas nunca a recebe duas vezes.

O listener de `message` roda com prioridade 10, acima da Luma (0), para a apresentação sair antes
da resposta dela, e não reivindica a mensagem.

Quem já falava com a Luma antes do plugin entrar não tem marca: recebe a apresentação uma vez, na
próxima mensagem que não for comando.

## Textos

`messages.intro` (`BRIDGER_WELCOME__MESSAGES__INTRO`), a apresentação antes do menu. `{prefix}` é
o prefixo do chat.
