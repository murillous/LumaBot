---
'@zapforge/core': minor
---

O `Contact` ganha os campos opcionais `username` (o `@usuario` do Telegram e do Discord), `isBot`
e `claims`. Os `claims` são atributos que o transport verificou, como os do JWT do web, e o
plugin só os lê. Um `Contact` só com `id`, `name` e `phone` continua válido.

Novo middleware oficial `ignoreBots`, **ligado por padrão** (`middlewares: { ignoreBots: false }`
desliga). Ele barra as mensagens, as edições, as reações e as deleções feitas por contatos com
`isBot: true`, para dois bots não entrarem em loop. No WhatsApp o `isBot` não vem preenchido,
então nada muda lá.
