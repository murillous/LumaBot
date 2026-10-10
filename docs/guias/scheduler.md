# Scheduler

O scheduler roda uma tarefa do plugin numa data marcada, mesmo que o bot tenha reiniciado no meio:
o job fica no storage. O detalhe está em [Scheduler no core](../../packages/core/docs/scheduler.md).

## Agendar e tratar

O plugin registra o handler do job no `setup` e agenda com `at`, de onde quiser:

```ts
import { command, definePlugin } from '@zapforge/core';

type Lembrete = { chatId: string; texto: string };

export const lembrete = definePlugin({
  name: 'lembrete',
  version: '0.1.0',
  engine: '<1.0.0',
  requires: ['send.text'],
  setup(ctx) {
    ctx.scheduler.on('lembrar', async (payload) => {
      const { chatId, texto } = payload as Lembrete;
      await ctx.send.send(chatId, `⏰ ${texto}`);
    });

    ctx.commands.add(
      command({
        name: 'lembrar',
        description: 'Lembra daqui a N minutos: !lembrar 10 tirar o bolo',
        run: async (c) => {
          const [minutos, ...resto] = c.args;
          const n = Number(minutos);
          if (!Number.isFinite(n) || n <= 0 || resto.length === 0) {
            return 'Use: !lembrar 10 tirar o bolo';
          }
          const dados: Lembrete = { chatId: c.message.chat.id, texto: resto.join(' ') };
          await ctx.scheduler.at(Date.now() + n * 60_000, 'lembrar', dados);
          return `Combinado, em ${n} min.`;
        },
      }),
    );
  },
});
```

| Método | O que faz |
| --- | --- |
| `at(quando, job, payload?)` | Agenda e devolve o id. `quando` é `Date` ou milissegundos |
| `on(job, handler)` | Registra o handler. Ele recebe `(payload, { signal })` |
| `cancel(id)` | `true` se o job existia e ainda não tinha disparado |

- **Registre o `on` no `setup`.** O job pertence ao plugin, não ao comando que o agendou: depois de
  um restart, ele espera o `on` para disparar.
- **O payload é JSON.** `Date`, `Map`, `undefined` e instâncias de classe são recusados com
  `TypeError`. Guarde a data como número (`date.getTime()`).
- **Os nomes são do plugin.** Dois plugins podem ter um job `lembrar` sem colidir.
- **Data no passado é válida:** o job dispara logo.

Para cancelar depois, guarde o id que o `at` devolveu, por exemplo no
[storage](storage.md), e chame `ctx.scheduler.cancel(id)`.

## Pelo menos uma vez

O job só sai do storage depois que o handler termina. Se o processo cair no meio do handler, o job
roda de novo quando o bot subir. Escreva o handler para tolerar uma repetição rara: confira no
storage se o trabalho já foi feito antes de refazer.

O handler que lança ou estoura o prazo (30 s) **não** é repetido: a falha vira `plugin.error`, e o
job sai. Para tentar de novo, trate o erro e agende outra vez:

```ts
ctx.scheduler.on('relatorio', async (payload, { signal }) => {
  try {
    await gerarRelatorio({ signal });
  } catch (err) {
    ctx.log.warn('relatório falhou; tento em 10 min', { err });
    await ctx.scheduler.at(Date.now() + 10 * 60_000, 'relatorio', payload);
  }
});
```

Repasse o `signal` a `fetch` e SDKs: ele aborta no prazo do job ou quando o plugin desce.

## Tarefa recorrente

Não há cron. Para repetir, o handler agenda a próxima execução:

```ts
const UM_DIA = 24 * 60 * 60_000;

setup(ctx) {
  ctx.scheduler.on('resumo-diario', async (payload) => {
    const { chatId } = payload as { chatId: string };
    await ctx.send.send(chatId, await montarResumo());
    await ctx.scheduler.at(Date.now() + UM_DIA, 'resumo-diario', payload);
  });
}
```

Agende a primeira execução a partir de um comando (`!resumo ligar`) e guarde o id para o
`!resumo desligar`. Agendar no `setup` criaria um job novo a cada boot e a cada reload.

## Tenant

O job agendado numa mensagem de um tenant guarda o tenant e roda nele: o `ctx.storage` do handler
lê os dados daquele cliente. O job agendado no `setup` roda sem tenant
([Storage → Tenants](storage.md#tenants-um-bot-vários-clientes)).

## Testar

O `receive()` do kit não espera os jobs. Teste o agendamento pela resposta:

```ts
const bot = await createTestBot({ plugins: [lembrete] });
await bot.receive({ text: '!lembrar 10 tirar o bolo' });
expect(bot.sent).toHaveReplied('Combinado, em 10 min.');
```

Um job com data no passado dispara logo; para conferir o efeito dele, espere com `expect.poll`:
`await expect.poll(() => bot.sent.length).toBe(2)`. Um handler longo fica mais fácil de testar
como função à parte, chamada pelo `on` e pelo teste. Mais em [Testes](testes.md).
