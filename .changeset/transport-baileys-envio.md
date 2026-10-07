---
'@zapforge/transport-baileys': minor
---

O transport passa a enviar e agir (#105, #106): declara as 17 capabilities do plano §6.10 e
implementa `send` (texto, imagem, vídeo, áudio, voz, sticker, documento e enquete, com citação e
menções), `react`, `edit`, `delete`, `sendPresence`, `getGroupMetadata` e
`updateGroupParticipants`. Citar uma mensagem recebida manda ao Baileys o proto original. Os
metadados de grupo ficam em cache por grupo, invalidado pelos eventos de grupo do Baileys, pela
alteração de participantes e a cada conexão, e o envio em grupo reaproveita o cache. Recusa de
qualquer participante no `updateGroupParticipants` lança com o status de cada um.
