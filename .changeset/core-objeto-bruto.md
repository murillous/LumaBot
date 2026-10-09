---
'@zapforge/core': minor
---

Objeto bruto da mensagem no escape hatch (ADR 0066).

- `ctx.unsafe.raw(message)` devolve o objeto de onde a mensagem saiu, no formato da plataforma,
  como `unknown`; `undefined` se o transport não o expõe ou a mensagem não veio dele. Na mensagem
  de um clique ou de um comando nativo, é o objeto bruto da interação.
- Mesmas regras do `native`: nunca bloqueia, e a primeira chamada de cada plugin loga um `warn`
  com plugin e transport, à parte do aviso do `native`.
- `Transport.raw?(source: Message | Interaction)` opcional, para o transport devolver o objeto
  que guardou num `WeakMap` da instância.
- Quem monta um `Unsafe` à mão precisa do método `raw`.
