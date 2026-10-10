---
'@zapforge/core': minor
---

`defineTransport` em `@zapforge/core/adapter` (ADR 0080): o adapter descreve só `name`,
`capabilities` (em lista), `connect`, `disconnect`, `send` e os métodos das capabilities que
declara, e recebe um kit com `emit` e `setSelf`. O `Transport` montado traz o emissor, o `on()`,
o `self`, a checagem de capability em cada método e o `UnsupportedError` no que falta. Novos
tipos: `TransportSpec` e `TransportKit`.

**Mudança de comportamento:** o `createBot` passa a recusar, com `BotConfigError`, o transport
com capability desconhecida, capability sem o método dela (`reactions` sem `react`) ou sem
`connect`, `disconnect`, `on` ou `send`. Antes, o erro só aparecia quando um plugin usava o
recurso.
