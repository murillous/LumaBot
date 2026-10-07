---
'@zapforge/core': patch
---

Corrige `message.edited` furando as barreiras da mensagem nova (M1-16). Antes, a edição ia do
transport direto aos listeners: chegava de chat bloqueado pelo `chatFilter`, da própria sessão
(`ignoreSelf`), sem o `sanitize` no `text`, fora da fila do chat e antes do fim do boot. Agora
ela entra na fila de entrada do chat, espera o boot e roda os middlewares (o `rateLimit` a conta
como uma mensagem); se passar, vai aos listeners de `message.edited`. Edição continua sem
disparar comando. Middlewares do app passam a ver edições e as distinguem por
`ctx.message.isEdited`.
