# Instância `Bot` e lifecycle

O `Bot` é a raiz do kernel: todo estado fica pendurado na instância, nunca em módulo
([ADR 0004](../../../docs/adr/0004-uma-sessao-por-processo.md)). Importar `@zapforge/core` e
chamar `createBot()` não abre conexão, não agenda timer e não registra listener de processo — o
efeito começa no `start()`.

```ts
import { createBot } from '@zapforge/core';

const bot = createBot({ transport });
await bot.start();
```

## Estados

`bot.state` é só leitura:

```
idle ──start()──▶ starting ──connect ok──▶ running ──stop()──▶ stopping ──▶ stopped
                      │                                            ▲
                      └──────────── connect falhou / stop() ───────┘
```

`stopped` é terminal: um bot parado não reinicia. Para subir de novo, crie outra instância.

| Chamada | `idle` | `starting` | `running` | `stopping` | `stopped` |
| --- | --- | --- | --- | --- | --- |
| `start()` | conecta | mesma promise | resolve | `BotStateError` | `BotStateError` |
| `stop()` | ganchos, sem `disconnect` | espera o connect e encerra | encerra | mesma promise | resolve |
| `onStop()` | registra | registra | registra | `BotStateError` | `BotStateError` |

- **`stop()` durante o `start()`**: o `stop()` espera o `connect()` assentar e então encerra; o
  `start()` pendente rejeita com `BotStateError`, porque o bot nunca chegou a `running`.
- **Falha no `connect()`**: o bot roda os ganchos de parada, chama `disconnect()` (o transport
  pode ter conectado pela metade — o adapter precisa tolerar isso) e termina em `stopped`. O
  `start()` rejeita com o erro do connect; se o encerramento também falhar, rejeita com um
  `AggregateError` cujo primeiro item é o erro do connect.

## Shutdown gracioso

`stop()` executa, em ordem:

1. os ganchos de parada, em **LIFO** (quem registrou por último desce primeiro);
2. `transport.disconnect()`.

Filas drenam e plugins fazem `teardown` registrando um gancho:

```ts
const remove = bot.onStop(async (signal) => {
  await queue.drain({ signal });
}, { name: 'fila-de-saida', timeoutMs: 10_000 });

remove(); // desfaz o registro, se o recurso for liberado antes
```

- Cada gancho tem um prazo (`timeoutMs` do gancho, ou `shutdown.hookTimeoutMs`, padrão 5 s).
  Estourado, o `signal` aborta e o bot segue para o próximo.
- O prazo total dos ganchos é `shutdown.timeoutMs` (padrão 15 s). Esgotado, os ganchos restantes
  não rodam. O `disconnect()` roda sempre, sem prazo.
- Erro de um gancho não impede os outros nem o `disconnect()`. No fim, o bot está em `stopped` e
  o `stop()` rejeita com um `AggregateError` com todas as falhas: cada gancho vira um
  `StopHookError` (`hookName`, `timedOut`, erro original em `cause`); o erro do `disconnect()`
  vai como veio.

```ts
const bot = createBot({ transport, shutdown: { hookTimeoutMs: 2000, timeoutMs: 8000 } });
```

## Sinais do processo

O core não instala handler de `SIGINT`/`SIGTERM` — isso é decisão do app:

```ts
process.once('SIGTERM', () => {
  bot.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
});
```
