---
'@zapforge/transport-baileys': minor
---

Emite `poll.vote` (ADR 0071). O transport guarda em memória as enquetes que envia e recebe (até
1000, esquecidas no `disconnect()`) e decifra o voto, que o Baileys 7 entrega cifrado, tentando o
telefone e o LID de quem criou e de quem votou. Voto de enquete que o transport não viu é
descartado com log em debug.
