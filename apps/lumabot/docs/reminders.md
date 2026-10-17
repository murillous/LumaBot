# Plugin `reminders`

Lembretes agendados, únicos ou recorrentes. Código em `src/plugins/reminders/`: `reminders.ts`
(plugin, serviço e comandos), `parse.ts` (parsers do `!lembrete`), `format.ts` (data, recorrência,
"faltam" e estatísticas) e `zone.ts` (fuso pelo `Intl`). Os três últimos são puros, sem `@usebridger/*`.
Port do `ReminderPlugin` do legacy.

## Comandos

| Comando | O que faz |
| --- | --- |
| `!lembrete [DD/MM[/AAAA]] HH:mm mensagem` (alias `!lembrar`) | Cria o lembrete. Sem data, vale hoje; sem ano, o ano corrente |
| `!lembrete todo dia HH:mm mensagem` | Série diária (`8h`, `8h30` e `às 8:00` também valem) |
| `!lembrete toda segunda[, quarta e sexta] HH:mm mensagem` | Série semanal, em um ou mais dias |
| `!lembrete a cada 1h30 mensagem` | Série por intervalo (`a cada 45min`, `a cada 2h`) |
| `!lembretes` | Lista os do chat por ordem da próxima ocorrência, com a recorrência, "faltam X" e estatísticas |
| `!cancelarlembrete <n>` | Cancela pelo número da lista; numa série, encerra a série inteira |

O horário digitado é do fuso da config (`timeZone`). No horário, o bot envia `⏰ Lembrete: texto` e
menciona (nós `mention` do texto formatado) quem foi marcado no comando, ou quem criou, se ninguém foi. Sem a capability `mentions`
no transport, o kernel cai para texto (o plugin exige só `send.text`).

Formato desconhecido dá o texto de uso (`usage`: nenhum parser entendeu o argumento). Data
inexistente (`31/02`) e mensagem vazia têm texto próprio (`errInvalidDate`, `errEmptyText`).
Só o horário, já passado hoje, cai em `errPast`: não pula para amanhã.

## Recorrência

A série é um `scheduler.every` do kernel. O horário `HH:mm` vale no `timeZone` do plugin e o
kernel cuida do horário de verão: `todo dia 08:00` continua às 08:00 locais, com 23 h ou 25 h
entre os disparos na virada (coberto em `reminders.test.ts`). O intervalo mínimo é de 15 minutos
(`errIntervalTooShort`). `!lembretes` mostra `🔁 recorrência` e a **próxima** ocorrência
(`scheduler.next`); uma série que o scheduler não conhece mais some da lista e é logada.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `create_reminder` | `text` e `when` (ISO 8601 com fuso, único) **ou** `repeat`: `{ everyMinutes }` ou `{ time: 'HH:mm', days?: 0..6[] }` | Cria o lembrete no chat; menciona quem a mensagem menciona, ou quem pediu. Devolve `id`, `when` (no fuso da config; na série, a próxima), `text` e, na série, `recurrence` | o `code` do `ReminderError` (sem `when` nem `repeat`: `invalid-recurrence`) |
| `list_reminders` | — | Pendentes do chat (`reminders`: `id`, `when`, `text` e `recurrence` na série) | — |
| `cancel_reminder` | `id` | Cancela pelo `id` da lista (a série inteira) | `not-found` |

A tool só cria o `kind` `text`; outros tipos vêm de plugins pelo serviço.

## Config

| Chave | Padrão | Env |
| --- | --- | --- |
| `timeZone` | `America/Sao_Paulo` | `BRIDGER_REMINDERS__TIME_ZONE` |

Fuso IANA. A conversão não depende do `TZ` do processo.

## Persistência e entrega

O disparo é um job (`at`) ou uma série (`every`) do scheduler do kernel (`fire`), que sobrevive a
restart; o bot desligado na hora dispara ao subir. A lista (`!lembretes`) vem da coleção
`reminders` do storage, que guarda o `jobId` (ou id da série) para o cancelamento. A entrega é
**pelo menos uma vez**: o documento único só sai depois da entrega, então uma queda no meio pode
repetir o aviso. Se a entrega falha, o erro vai ao `plugin.error`, o lembrete único sai da lista
e não é re-tentado (política do scheduler). **A série não sai após o disparo**: o documento fica
até o cancelamento, e uma falha atinge só aquela ocorrência. Se o plugin dono do `kind` está
desligado, o disparo é logado (`warn`) e não entrega: o único sai da lista, a série espera o
plugin voltar.

## Serviço `reminders`

Quem não é comando (a IA do M5) usa o mesmo caminho do `!lembrete`:

```ts
const reminders = ctx.services.get('reminders');
const r = await reminders.create({
  chatId, creatorId, mentionIds: [], // vazio = menciona o criador
  text: 'ligar para a Ana',
  fireAt: Date.now() + 3_600_000, // ou recurrence: { time: '08:00', days: [1, 3] } / { everyMs }
});
// Série: segunda e quarta às 19:00 no fuso do plugin; `fireAt` do retorno é a próxima ocorrência.
await reminders.create({
  chatId, creatorId, mentionIds: [], text: 'reunião',
  recurrence: { time: '19:00', days: [1, 3] },
});
await reminders.list(chatId); // por ordem de disparo
await reminders.cancel(chatId, r.id); // false se não existe ou é de outro chat
```

O `create` valida e lança `ReminderError` com `code`: `invalid-chat`, `invalid-date`, `past`,
`too-far` (mais de 1 ano), `empty-text` e `text-too-long` (mais de 500 caracteres) e, do tipo e da
recorrência, `unknown-kind` (kind sem plugin em `reminders.kinds`), `invalid-recurrence` (`time` fora
de `HH:mm`, `days` vazio ou fora de 0..6, `everyMs` que não é um número inteiro de minutos, ou nem `fireAt` nem `recurrence`, ou
os dois) e `interval-too-short` (`everyMs` abaixo de 15 min). `invalid-date` e `past` valem só para o
disparo único; `too-far` vale também para um intervalo acima de 1 ano. O texto perde
caracteres de controle e invisíveis (exceto quebra de linha). Quem chama traduz o `code` em texto
(o comando usa as `messages` `err*`).

## Pontos de extensão

O `reminders` fica fechado para modificação: outro plugin estende sem editá-lo, declarando
`dependsOn: { reminders: '^2.0.0' }`.

### `reminders.parsers`

Tipo: `WhenParser = (text: string, now: Date) => ParsedReminder | null`, com
`ParsedReminder = { fireAt, text } | { recurrence, text }`. Recebe o argumento inteiro do
`!lembrete`; `null` passa a vez. O comando tenta os parsers na ordem de carga e usa o primeiro
que casar; o plugin contribui o do formato `[DD/MM[/AAAA]] HH:mm msg` e o das séries. Parser que
lança é logado e ignorado.

```ts
export const emMinutos = definePlugin({
  name: 'reminders-em-minutos',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { reminders: '^2.0.0' },
  setup: (ctx) => {
    ctx.services.contribute('reminders.parsers', (input, now) => {
      const m = /^em (\d+) min \| (.+)$/.exec(input);
      return m ? { fireAt: now.getTime() + Number(m[1]) * 60_000, text: m[2] } : null;
    });
  },
});
```

### `reminders.kinds`

Define o que acontece no horário. Tipo: `ReminderKind = { kind: string; deliver(reminder, { signal }) }`.
O próprio plugin contribui o `'text'` (`⏰ Lembrete: texto` com menções). O `deliver` recebe o
`Reminder` com o `data` guardado no `create`; `text` é o rótulo que `!lembretes` mostra. Lançar
manda a falha ao `plugin.error`, e numa série as próximas ocorrências seguem.

Se dois plugins contribuem o mesmo `kind`, vale o primeiro na ordem de carga.

Exemplo: a Luma manda uma figurinha todo dia às 09:00 (ilustrativo).

```ts
export const figurinhaDiaria = definePlugin({
  name: 'figurinha-diaria',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { reminders: '^2.0.0' },
  setup: (ctx) => {
    ctx.services.contribute('reminders.kinds', {
      kind: 'sticker',
      deliver: async (r) => {
        const { file } = r.data as { file: string };
        await ctx.send.send(r.chatId, sticker(await readSticker(file)));
      },
    });
    // Em algum comando ou evento do plugin:
    //   await ctx.services.get('reminders').create({
    //     chatId, creatorId, mentionIds: [], text: 'figurinha do dia',
    //     kind: 'sticker', data: { file: 'bom-dia.webp' },
    //     recurrence: { time: '09:00' },
    //   });
  },
});
```

## Textos

Em `messages`, sobrescrevíveis pela config (`usage` → `BRIDGER_REMINDERS__MESSAGES__USAGE`).
`{prefix}` vira o prefixo do chat; os demais placeholders aparecem no texto padrão.

## Diferenças do legacy

- Sem o `|` antes da mensagem, e a data virou opcional (no legacy, `DD/MM HH:mm | mensagem`).
- Mensagem acima de 500 caracteres é recusada, não cortada (o legacy truncava em silêncio).
- "A data não existe" virou "Data/hora inválida" (`errInvalidDate`); o resto dos textos é o do legacy.
- Datas no passado e a mais de 1 ano seguem recusadas, como no legacy.
- Recorrência (diária, semanal, intervalo) é nova; o legacy só tinha disparo único.
- Sem o loop próprio de 30 s: o scheduler do kernel arma um timer para o próximo job.
- Não há mais o `console.log` de depuração da lista.
