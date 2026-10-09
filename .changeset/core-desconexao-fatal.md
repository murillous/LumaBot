---
'@zapforge/core': minor
---

Desconexão fatal e transport sem pareamento (ADR 0068). Corrige o laço de `clean-session` de um
token inválido (#280).

- `DisconnectReason` ganha `'fatal'`: erro de configuração que reconectar não resolve (token sem
  permissão, intents, porta ocupada). A `ReconnectionPolicy` decide `stop` com causa `fatal`.
- Capability `pairing`: a sessão se pareia por QR ou código. Sem ela, `auth-failed` decide `stop`
  com causa `auth-failed`, em vez de limpar a sessão e falhar de novo a cada
  `minCleanIntervalMs`. `ReconnectionPolicyOptions.pairing` (padrão `true`); o `Bot` a preenche
  com a capability do transport, e `BotReconnectionOptions` não a aceita.
- O bot loga esses dois `stop` em `fatal`, com `reason`, `cause` e o erro nativo em `err`, e para.
  O `closed` chega aos listeners de `connection.status` antes, para o app decidir o código de
  saída.
- `docs/transport.md`: o adapter sobre uma lib que se reconecta sozinha só emite `closed` quando
  a queda é terminal, e uma tabela de mapeamento de Discord, Telegram e web.
- Um transport que pareia por QR e emite `auth-failed` precisa declarar `pairing` para continuar
  limpando a sessão. Um `switch` exaustivo sobre o `DisconnectReason` ou sobre a causa do `stop`
  precisa tratar `fatal` (e `auth-failed`, na causa).
