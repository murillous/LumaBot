---
'@zapforge/core': minor
---

Queda de rede nunca apaga as credenciais (#236, ADR 0044). Antes, `connection-lost`/`unknown`
reconectavam 3 vezes (5, 10, 15 s) e depois decidiam `clean-session` (`reconnect-limit`): com
transport por fábrica, ~30 s de rede fora apagavam o `auth` e exigiam parear de novo. Agora a
reconexão segue com o backoff sem limite de tentativas, e `clean-session` só vem de
`logged-out`, `auth-failed` ou `qr-limit`. **Quebra:** saem a opção
`reconnection.maxReconnectAttempts` e a causa `'reconnect-limit'` de `ReconnectionDecision`.
