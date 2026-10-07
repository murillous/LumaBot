---
'@zapforge/core': minor
---

Escape hatch `ctx.unsafe.native` (M1-15): `createUnsafeAccess({ transport, log })` cria, por bot,
a fábrica de `Unsafe`; `forPlugin(manifest)` devolve um `Unsafe` cujo `native` (`unknown`) lê o
objeto nativo atual do transport e loga um aviso `warn` uma única vez por plugin, avisando quando
o manifesto não declara `transports`.
