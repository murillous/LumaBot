---
'@zapforge/core': minor
---

Comandos nativos: o transport lê a lista de comandos e recebe os comandos chamados pelo menu da
plataforma (ADR 0064).

- `TransportDeps.commands` (opcional): `list()` devolve os comandos como `CommandInfo`, e
  `onChange(listener)` avisa que a lista mudou, uma vez ao fim de cada reload e uma vez por tick
  para os comandos adicionados fora dele. Não avisa no boot nem a partir do `stop()`.
- O `Interaction` vira a união de `ActionInteraction` (`actionId`, o clique num botão) e
  `CommandInteraction` (`command` e `args` em texto livre). O kernel roda o comando nativo como o
  digitado, sem prefixo, com papel, recusa e evento `command`.
- Quem lê `Interaction.actionId` precisa estreitar o tipo antes (`interaction.command ===
  undefined`).
- Novos exports em `@zapforge/core/adapter`: os tipos `TransportCommands`, `ActionInteraction` e
  `CommandInteraction`.
