---
'@zapforge/testing': minor
---

O `FakeTransport` implementa `raw()` e ganha `setRaw(source, raw)`, e o `receive()` (também na
citada descrita) e o `click()` aceitam `raw`, para testar plugin que lê o objeto bruto com
`ctx.unsafe.raw()` (ADR 0066). Sem `raw`, o `ctx.unsafe.raw()` devolve `undefined`.
