---
'@zapforge/transport-baileys': minor
---

O transport passa a receber mensagens (#104): cada mensagem nova do `messages.upsert` vira o
evento `message` com a `Message` normalizada do core. Os envelopes ephemeral, viewOnce e
documentWithCaption são desembrulhados (`isViewOnce` marcado), a citada vem como `Message` e
`sender`, `mentions` e o autor da citada trazem `phone` resolvido também quando o id é um LID,
para os `owners` e o `group-admin` funcionarem. A mídia baixa sob demanda. Histórico (`append`),
status e mensagens de controle (edição, reação, apagamento) não viram `message`.
