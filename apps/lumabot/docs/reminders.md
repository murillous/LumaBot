# Plugin `reminders`

Lembretes agendados. Código em `src/plugins/reminders/`: `reminders.ts` (plugin, serviço e
comandos), `parse.ts` (parser do formato `[DD/MM[/AAAA]] HH:mm mensagem`), `format.ts` (data, "faltam" e
estatísticas) e `zone.ts` (fuso pelo `Intl`). Os três últimos são puros, sem `@usebridger/*`.
Port do `ReminderPlugin` do legacy.

## Comandos

| Comando | O que faz |
| --- | --- |
| `!lembrete [DD/MM[/AAAA]] HH:mm mensagem` (alias `!lembrar`) | Cria o lembrete. Sem data, vale hoje; sem ano, o ano corrente |
| `!lembretes` | Lista os do chat por ordem de disparo, com "faltam X" e estatísticas |
| `!cancelarlembrete <n>` | Cancela pelo número da lista |

O horário digitado é do fuso da config (`timeZone`). No horário, o bot envia `⏰ Lembrete: texto` e
menciona (nós `mention` do texto formatado) quem foi marcado no comando, ou quem criou, se ninguém foi. Sem a capability `mentions`
no transport, o kernel cai para texto (o plugin exige só `send.text`).

Formato desconhecido dá o texto de uso (`usage`: nenhum parser entendeu o argumento). Data
inexistente (`31/02`) e mensagem vazia têm texto próprio (`errInvalidDate`, `errEmptyText`).
Só o horário, já passado hoje, cai em `errPast`: não pula para amanhã.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `create_reminder` | `when` (ISO 8601 com fuso), `text` | Cria o lembrete no chat; menciona quem a mensagem menciona, ou quem pediu. Devolve `id`, `when` (no fuso da config) e `text` | o `code` do `ReminderError` |
| `list_reminders` | — | Pendentes do chat (`reminders`: `id`, `when`, `text`) | — |
| `cancel_reminder` | `id` | Cancela pelo `id` da lista | `not-found` |

## Config

| Chave | Padrão | Env |
| --- | --- | --- |
| `timeZone` | `America/Sao_Paulo` | `BRIDGER_REMINDERS__TIME_ZONE` |

Fuso IANA. A conversão não depende do `TZ` do processo.

## Persistência e entrega

O disparo é um job do scheduler do kernel (`fire`), que sobrevive a restart; o bot desligado na
hora dispara ao subir. A lista (`!lembretes`) vem da coleção `reminders` do storage, que guarda o
`jobId` para o cancelamento. A entrega é **pelo menos uma vez**: o documento só sai depois do
envio, então uma queda no meio pode repetir o aviso. Se o envio falha, o erro vai ao
`plugin.error`, o lembrete sai da lista e não é re-tentado (política do scheduler).

## Serviço `reminders`

Quem não é comando (a IA do M5) usa o mesmo caminho do `!lembrete`:

```ts
const reminders = ctx.services.get('reminders');
const r = await reminders.create({
  chatId, creatorId, mentionIds: [], // vazio = menciona o criador
  text: 'ligar para a Ana',
  fireAt: Date.now() + 3_600_000,
});
await reminders.list(chatId); // por ordem de disparo
await reminders.cancel(chatId, r.id); // false se não existe ou é de outro chat
```

O `create` valida e lança `ReminderError` com `code`: `invalid-chat`, `invalid-date`, `past`,
`too-far` (mais de 1 ano), `empty-text` e `text-too-long` (mais de 500 caracteres). O texto perde
caracteres de controle e invisíveis (exceto quebra de linha). Quem chama traduz o `code` em texto
(o comando usa as `messages` `err*`).

## Ponto de extensão `reminders.parsers`

Tipo: `WhenParser = (text: string, now: Date) => { fireAt: number; text: string } | null`. Recebe
o argumento inteiro do `!lembrete`; `null` passa a vez. O comando tenta os parsers na ordem de
carga e usa o primeiro que casar; o do formato `[DD/MM[/AAAA]] HH:mm msg` é contribuído pelo próprio
plugin. Parser que lança é logado e ignorado.

```ts
export const emMinutos = definePlugin({
  name: 'reminders-em-minutos',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { reminders: '^1.0.0' },
  setup: (ctx) => {
    ctx.services.contribute('reminders.parsers', (input, now) => {
      const m = /^em (\d+) min \| (.+)$/.exec(input);
      return m ? { fireAt: now.getTime() + Number(m[1]) * 60_000, text: m[2] } : null;
    });
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
- Sem o loop próprio de 30 s: o scheduler do kernel arma um timer para o próximo job.
- Não há mais o `console.log` de depuração da lista.
