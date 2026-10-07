# Scheduler

Agendamento persistido (plano §6.8): o plugin agenda um job para uma data, e o kernel chama o
handler nessa hora, mesmo que o bot tenha reiniciado no meio. Um único loop serve o bot inteiro.

## Para autores de plugin

```ts
setup(ctx) {
  ctx.scheduler.on('reminder.fire', async (payload) => {
    const { chatId, text } = payload as { chatId: string; text: string };
    await ctx.send.text(chatId, text);
  });

  const id = await ctx.scheduler.at(new Date(Date.now() + 60_000), 'reminder.fire', {
    chatId,
    text: 'Hora da reunião',
  });
  // ...
  await ctx.scheduler.cancel(id);
}
```

| Método | O que faz |
| --- | --- |
| `at(when, job, payload?)` | Persiste o job e devolve o id. `when` é `Date` ou epoch ms |
| `on(job, handler)` | Registra o handler do job; devolve a função que o remove. O handler recebe `(payload, { signal })` |
| `cancel(id)` | `true` se o job existia e ainda não tinha disparado |

- **Namespace por plugin.** Dois plugins podem usar o mesmo nome de job sem colidir. Um plugin
  não dispara nem cancela os jobs de outro: `cancel` com id alheio devolve `false`.
- **Um handler por job.** Um segundo `on` para o mesmo job lança `JobHandlerConflictError`.
  Para trocar o handler, chame antes a função devolvida pelo primeiro `on`.
- **Payload é JSON.** Sem payload, o handler recebe `null`. O que o JSON perderia ou mudaria em
  silêncio é recusado com `TypeError`: `undefined`, `NaN`/`Infinity`, `Date`, `Map`, instâncias
  de classe, `bigint`, funções e referências circulares. Converta antes (`date.getTime()`).
- **Validação.** `at` rejeita com `TypeError` se a data é inválida (`new Date('x')`, `NaN`,
  `Infinity`) ou se o nome do job é vazio. Data no passado é válida: o job dispara logo.
- **Registre o `on` no `setup`.** Os jobs são do plugin, não do `setup`: continuam no storage
  quando o plugin é desabilitado ou recarregado e disparam quando ele registrar o handler.

### Semântica de entrega

**Pelo menos uma vez.** O job só sai do storage **depois** que o handler termina. Se o processo
cair com o handler rodando, o job dispara de novo quando o bot subir. Escreva handlers
idempotentes, ou que tolerem uma repetição rara.

| Situação | O que acontece |
| --- | --- |
| Bot desligado na hora do job | Dispara assim que o bot sobe (`start`) |
| Job vencido sem handler (plugin desabilitado, ainda no `setup`) | Fica pendente no storage; dispara quando o `on` do job for registrado |
| Handler lança, rejeita ou estoura o prazo (30 s) | Falha vai ao `plugin.error` com `phase: 'scheduler'` e o nome do job em `event`. O job **não** é re-tentado: sai do storage, e o loop segue |
| `cancel` com o handler rodando | `false`; o job sai quando o handler terminar |

Não há retentativa automática: a maioria dos handlers manda mensagem, e repetir em loop um
envio que falha por motivo permanente seria pior que perder um lembrete. Quem precisa de
retentativa trata o erro no handler e chama `at` de novo com o atraso que quiser.

Jobs vencidos disparam em ordem de horário e sem esperar um pelo outro.

### Prazo e `signal`

O segundo argumento do handler (`JobContext`) traz `signal: AbortSignal`, que aborta quando o
handler estoura o prazo (`timeouts.jobMs`, padrão 30 s), com `reason` = `JobTimeoutError`
(`plugin`, `job`, `timeoutMs`).
Handlers de um parâmetro só continuam valendo. Repasse o `signal` a `fetch`/SDKs e confira
`signal.aborted` antes de efeitos que não o recebem: o `ctx.send`/`ctx.storage` do `setup` são do
plugin e não sabem do prazo do job ([ADR 0033](../../../docs/adr/0033-cancelamento-cooperativo.md)).

```ts
ctx.scheduler.on('relatorio', async (payload, { signal }) => {
  const dados = await fetch(api, { signal }).then((r) => r.json());
  signal.throwIfAborted();
  await ctx.send.send(chatId, { type: 'text', text: resumo(dados) });
});
```

Depois do descarte do plugin (teardown, reload), `ctx.scheduler.at`/`cancel` rejeitam com
`ContextExpiredError`. Código síncrono travado bloqueia o processo inteiro.

## Para o kernel

Peça interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)).

```ts
import { createSchedulerService } from '#scheduler/service.ts';

const scheduler = createSchedulerService({
  storage, // StoragePort do bot
  onError: (event) => { /* plugin.error: log + barramento */ },
  onLateError: (event) => { /* opcional: rejeição depois do prazo, só log */ },
  onStorageError: (error) => { /* log */ },
  jobTimeoutMs: 30_000, // opcional
  storageRetryMs: 5000, // opcional
});

ctx.scheduler = scheduler.forPlugin(plugin.name); // ao montar o PluginContext
scheduler.removePlugin(plugin.name);              // no teardown/reload
scheduler.start();                                // quando o bot fica pronto
await scheduler.stop();                           // gancho de parada
```

- **Um serviço por bot.** Os jobs de todos os plugins ficam em uma coleção do namespace do kernel
  (`kernelStorage(storage, 'scheduler')`, coleção `jobs`, indexada por `fireAt`). Nenhum plugin
  alcança essa coleção pelo `ctx.storage`.
- **Um único timer.** O serviço arma no máximo um `setTimeout`, para o próximo job. Sem job
  futuro, não há timer (nada de polling). Um job mais distante que o teto do `setTimeout`
  (~24,8 dias) arma o teto; o loop acorda, recalcula e rearma.
- **`start()`** dispara os jobs vencidos (inclusive os do downtime) e arma o próximo. Antes dele,
  `at` só persiste.
- **`stop()`** desarma o timer e espera os handlers em andamento. Cada handler já é limitado por
  `jobTimeoutMs`, então o `stop` termina em no máximo esse prazo. Depois dele não sobra timer
  vivo. Os jobs ficam no storage para o próximo `start`. É idempotente, e `start` de novo retoma.
- **`stop(signal)`** faz o mesmo, mas, quando o `signal` aborta, abandona os handlers que ainda
  rodam: o `signal` do job aborta, o prazo dele é desarmado e o job **fica no storage**, para
  disparar de novo na próxima subida (pelo menos uma vez). O bot usa isso quando o gancho de
  parada do scheduler estoura o prazo.
- **`removePlugin(nome)`** tira os handlers do plugin, mas **não** apaga os jobs persistidos.
- **Falhas.** Falha de handler vai ao `onError` como `PluginErrorEvent`. Falha do storage (a
  consulta do loop ou a remoção depois do handler) vai ao `onStorageError`, e o loop tenta de
  novo depois de `storageRetryMs`. Se a remoção falhar, o job continua no storage e é entregue
  de novo (pelo menos uma vez). Os callbacks não devem lançar.
- **Rejeição depois do prazo.** O job já saiu como timeout no `onError`; a rejeição que chega
  depois vai ao `onLateError` (padrão: o próprio `onError`). O `Bot` a liga só ao log, para ela
  não virar um segundo `plugin.error`. Uma `ContextExpiredError` tardia não é repassada: a recusa
  já foi logada quando aconteceu.
- O `onError` **não** emite `plugin.error` no barramento sozinho: quem liga isso é o `Bot`, que
  loga a falha e a emite. O `Bot` também liga o `onStorageError` ao log, chama `start()` quando
  termina o boot e `stop()` num gancho de parada ([Bot](bot.md#shutdown-gracioso-stop)).
