---
'@zapforge/testing': minor
---

Entry `@zapforge/testing/bot` (#117): exporta o mesmo kit (`createTestBot`, `FakeTransport`,
`fixtures`) sem registrar os matchers e sem carregar o Vitest. Serve para subir o bot de teste
fora de um teste, como no benchmark, onde o Vitest somava ~6 MB de RSS à medida.
