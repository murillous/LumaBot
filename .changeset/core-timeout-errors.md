---
'@zapforge/core': minor
---

Timeouts tipados e menos ruído no log (ADRs 0032 e 0033). O `signal` de listener e de job aborta
com `ListenerTimeoutError` e `JobTimeoutError` (antes, um `Error` genérico); os dois e o
`CommandTimeoutError` estendem o novo `ExecutionTimeoutError` (`plugin`, `timeoutMs`). Uma
`ContextExpiredError` que escapa do plugin depois do prazo não é logada de novo como erro tardio,
e a rejeição tardia de um job vai só ao log (`onLateError` em `createSchedulerService`), sem um
segundo `plugin.error`. O logger ignora segredos com menos de `MIN_SECRET_LENGTH` (4) caracteres,
e a config de plugin avisa, uma vez por campo, do segredo curto demais para ser censurado.

A config de plugin recusa (como erro do autor, plugin ignorado no boot) `secret()` fora de campo
de `z.object` — dentro de array, record ou union ele passava sem censura, sem máscara e aceito por
override — e dois campos (ou chaves de `messages`) que geram a mesma variável de ambiente, como
`openAIKey` e `openAiKey`.
