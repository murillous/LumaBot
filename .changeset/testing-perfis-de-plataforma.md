---
'@zapforge/testing': minor
---

Perfis de plataforma no kit (ADR 0073): `new FakeTransport({ profile })` e
`createTestBot({ profile })` com `whatsapp`, `telegram`, `discord` e `web`. Cada perfil declara as
capabilities, os limites de tamanho e os contatos (`self` e remetente padrão do `receive()` e do
`click()`) da plataforma: sem telefone no Telegram, no Discord e no web. `PROFILES` e
`PROFILE_NAMES` permitem rodar o mesmo teste em todos os perfis com `describe.each`. Sem perfil,
nada muda. Os IDs gerados pelo `receive()` passam a recomeçar em cada `TestBot`, sem contador de
módulo.
