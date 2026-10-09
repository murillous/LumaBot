---
'@zapforge/core': minor
---

`LocationMessage.location.address`, opcional: o endereço, quando a plataforma informa (o `venue`
do Telegram, por exemplo). Política das uniões (ADR 0069): `MessageType` e `OutgoingContent`
continuam fechadas e podem ganhar membros numa minor, na saída sempre atrás de capability nova.
Plugin e transport tratam `unknown` e usam `default` no `switch`, nunca o `never` exaustivo.
