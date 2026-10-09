---
'@zapforge/core': minor
---

`owners` aceita `{ id }` além do telefone: `createBot({ owners: ['+55 11 99999-9999', { id: '123456789012345678' }] })`.
O `{ id }` é comparado com `sender.id` e torna possível ter dono em plataformas sem telefone
(Discord, Telegram, web). Telefones continuam válidos como antes e nunca se cruzam com IDs. Um
`{ id }` vazio, com espaço nas pontas ou que não é texto lança `BotConfigError` no `createBot`.
