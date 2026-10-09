---
'@zapforge/core': minor
---

Texto formatado neutro, menções portáteis e limites de tamanho (ADR 0061).

- `fmt`, `bold`, `italic`, `code`, `link` e `mention` montam um `FormattedText` que o transport
  traduz para a marcação da plataforma. `plainText` devolve o texto visível. Texto cru (string)
  continua indo como veio.
- `ctx.reply`, a legenda dos atalhos de mídia, `ctx.send.edit` e `ctx.send.send` aceitam
  `MessageText` (string ou `FormattedText`). O `ctx.send.send` também aceita só o texto no lugar
  do conteúdo.
- `OutgoingContent` ganha `formatted` e `formattedCaption` opcionais, com o texto visível em
  `text` e `caption`. `Transport.edit` ganha o parâmetro opcional `formatted`. Um transport que
  não conhece os campos novos envia o texto visível.
- `Transport.limits` opcional (`text`, `caption`, `measure`). A fila de saída divide o texto e a
  legenda acima do limite em várias mensagens, sem quebrar a formatação. Só a primeira parte
  cita, e a chave devolvida é a dela. O `edit` acima do limite rejeita com `RangeError`.
- Novos exports: `bold`, `code`, `fmt`, `italic`, `link`, `mention`, `plainText` e os tipos
  `FormattedText`, `MentionTarget`, `MessageText`, `TextLimits`, `TextNode` e `TextPart`.
