---
'@zapforge/core': minor
---

Ações e botões: o clique dispara um comando, com fallback em texto numerado (ADR 0062).

- `ctx.reply(text, { actions })` e `ctx.reply.text` aceitam `actions`: `{ label, command, args? }`
  roda um comando registrado, e `{ label, step, data? }` roda um passo de conversa do plugin. O
  clique passa pela fila do chat e pelos middlewares e segue o caminho do comando digitado, com
  papel, recusa, evento `command` e `plugin.error`.
- O botão leva só um ID opaco, preso ao chat e válido por 24 horas. Clique vencido, desconhecido
  ou de outro chat é descartado com log em `debug`.
- Capability `actions`, `SendOptions.actions` (`{ id, label }`), `TextLimits.actions` e o evento
  `interaction` no `TransportEvents`, que o kernel consome e não repassa aos plugins.
- Sem a capability, ou acima de `limits.actions`, o texto ganha o menu numerado, e o número que o
  remetente responder roda a ação.
- `CommandRouter.dispatch` ganha o segundo parâmetro opcional `invocation`.
- Novos exports: os tipos `CommandAction`, `MessageAction`, `StepAction`, `ReplyTextOptions` e
  `OutgoingAction`, e `Interaction` em `@zapforge/core/adapter`.
