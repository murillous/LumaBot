---
'@zapforge/core': minor
---

Barramento de eventos (M1-7): `createEventBus()` com todos os eventos do §6.4 tipados, incluindo
`message:<type>` derivado de `message`; filtros declarativos (`on('message', { quoted: 'audio' },
h)`, opções no meio ou no fim); listeners iniciados em paralelo por prioridade, com `claim()`
compartilhado na emissão; isolamento por try/catch + timeout por listener, com falhas emitidas
como `plugin.error` (nome do plugin, evento, `timedOut`) e entregues ao `onError` do bus;
`forPlugin`/`removePlugin` para atribuir e remover os listeners de cada plugin.
