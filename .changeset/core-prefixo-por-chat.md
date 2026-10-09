---
'@zapforge/core': minor
---

Prefixo de comando por tipo de chat e por chat (ADR 0063). `BotConfig.prefix` aceita também
`{ dm, group }`, e o prefixo vazio passa a ser permitido: a primeira palavra vira o token. O novo
`ctx.prefixes` (`get`, `set`, `reset`) troca o prefixo de um chat, gravado no storage e lido no
boot. O roteador tira o `@usuario` da própria sessão do token, então `/start@MeuBot` de um grupo
do Telegram roda `start`. Prefixo começado por espaço em branco agora lança `TypeError`. Tipos
novos: `PrefixConfig` e `Prefixes`.
