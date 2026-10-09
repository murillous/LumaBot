---
'@zapforge/testing': minor
---

Botões no kit (ADR 0062): o `FakeTransport` declara a capability `actions` por padrão e registra
os botões em `SentMessage.actions`, e o `TestBot` ganha `click(sent, label, options?)`, que clica
num botão pelo rótulo e espera o bot assentar.
