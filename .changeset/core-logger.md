---
'@zapforge/core': minor
---

Logger estruturado (M1-14): `createLogger(options)` sobre pino, com nível configurável (padrão
`info`), destino injetável, `bindings` base, `child()` que acumula contexto (`plugin`, `chatId`),
`err` serializado com `message`, `stack` e `cause`, redação de segredos por caminho (`redact`) e
por valor (`secrets`), e `createNoopLogger()` para testes e padrões.
