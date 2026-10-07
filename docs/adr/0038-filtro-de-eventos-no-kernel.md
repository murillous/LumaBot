# ADR 0038 — chatFilter e ignoreSelf valem para os eventos que não são mensagem

**Status:** Aceito (2026-10-07) · Detalha a decisão **D24** ([ADR 0024](0024-papeis-no-core.md)) na parte do allow/blocklist de chats

## Contexto

O ADR 0024 fez do allow/blocklist de chats um middleware oficial, e o `ignoreSelf` também é um
middleware. Middlewares rodam sobre `MessageContext`, e por isso só valem para `message` e, desde a
#197, para `message.edited`. Os outros eventos do transport (`reaction`, `message.deleted` e
`group.*`) iam direto ao barramento (#219). Com isso:

- um chat bloqueado continuava entregando reações, deleções e mudanças de grupo aos plugins;
- a reação da própria sessão chegava aos listeners, e um plugin que reage a reações podia entrar
  em laço consigo mesmo;
- o evento que chegava durante o `setup` assíncrono de um plugin se perdia.

Para saber se uma reação ou deleção é da própria sessão, o kernel teria de comparar
`sender.id` com `transport.self.id`. Isso é frágil: no WhatsApp, o mesmo contato aparece ora como
LID, ora como JID de telefone. Só o adapter sabe a resposta com certeza, como já sabe para a
`Message` (`fromMe`).

Alternativas consideradas:

- **Middlewares genéricos**, com um contexto por tipo de evento. Mudaria o contrato de
  `Middleware` e o ADR 0012, e todo middleware do app teria de tratar contextos sem `message`.
- **Comparar com `transport.self`**, sem mudar o contrato. Frágil, pelo motivo acima.
- **Pôr esses eventos na fila do chat.** Garante a ordem, mas eles passam a ocupar vaga do
  `maxPendingPerChat` e a esperar listeners lentos, e uma rajada de reações pode fazer uma
  mensagem ser descartada.

## Decisão

- O kernel aplica as mesmas opções `middlewares.chatFilter` e `middlewares.ignoreSelf` aos
  eventos que não são mensagem, antes de repassá-los ao barramento. Não há opção nova: quem
  bloqueia um chat bloqueia tudo o que vem dele.
- O `chatFilter` barra `reaction` e `message.deleted` (por `chat.id`) e `group.participants` e
  `group.updated` (por `groupId`). `group.joined` e `group.left` sempre passam, porque são o ciclo
  de vida do próprio bot no grupo e servem para o plugin limpar estado.
- O `ignoreSelf` barra `reaction` e `message.deleted` com `fromMe: true`. Os dois payloads ganham
  o campo `fromMe: boolean` em `TransportEvents`, preenchido pelo adapter.
- Esses eventos esperam o fim do boot, como a mensagem, mas não entram na fila do chat.
- Middlewares continuam só de mensagem, e os do app não veem esses eventos.

## Consequências

- Bloquear um chat cala o bot para tudo o que vem dele, menos a entrada e a saída do grupo.
- `fromMe` em `reaction` e `message.deleted` é obrigatório no contrato de adapter. Isso quebra
  adapters existentes, mas o repositório ainda não tem nenhum real.
- Um evento que chega durante o boot não se perde mais. Depois do `stop()`, é descartado.
- A ordem entre uma reação e a mensagem do mesmo chat não é garantida: a reação pode chegar aos
  listeners antes de a mensagem reagida terminar de ser processada.
- O custo por evento é uma consulta a um `Set`, sem fila nem pipeline.
