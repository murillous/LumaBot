---
'@zapforge/core': minor
---

Capabilities multiplataforma (ADR 0070). **Quebra de API antes do 1.0.**

- A capability `presence` dá lugar a `typing`. O `Transport` troca `sendPresence(chatId, presence)`
  por `sendTyping(chatId, kind)`, com `TypingKind = 'text' | 'voice'`, e o tipo `Presence` sai. No
  plugin, `ctx.send.presence(chat, 'composing')` vira `ctx.send.typing(chat, 'text')`, e o
  `requires: ['presence']` vira `['typing']`. O status online global (`available`/`unavailable`) e o
  `paused` saem do contrato: use `ctx.unsafe.native`. A opção `outbound.onPresenceError` passa a se
  chamar `onTypingError`.
- Enquete: `multiple?: boolean` no lugar de `selectableCount?: number`, no `OutgoingContent` e no
  `ctx.reply.poll`.
- O contrato de `react` e `delete` fica explícito: a sessão tem uma reação por mensagem (`react`
  substitui, `null` remove a da sessão); apagar mensagem de outra pessoa exige admin ou a permissão
  da plataforma.
