---
'@zapforge/testing': minor
---

Novo pacote: kit de testes para autores de plugin (#113). `createTestBot({ plugins })` sobe um
bot real sobre o `FakeTransport`, sem rede. `bot.receive({ text, image, quoted... })` entrega uma
mensagem e resolve depois que o bot terminou de processá-la, e `bot.sent` guarda os envios na
ordem. Importar o pacote registra os matchers do Vitest `toContainText`, `toContainSticker`,
`toContainImage` e `toHaveReplied`.
