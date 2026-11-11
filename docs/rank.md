# rank

Ranking de quem mais interage com a Luma. Dados no storage do próprio plugin (coleções
`perChat` e `totals`; o total é separado para o `!rank global` não somar todos os chats).

## Comandos

| Comando | O que faz |
| --- | --- |
| `!rank` | Top 10 do grupo; em conversa privada, sempre o global |
| `!rank global` | Top 10 somando todos os chats |

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `ranking` | `scope` (`chat`, padrão, ou `global`) | Top 10 com `name` e `count`; em conversa privada, sempre o geral | — |

## Quem conta

Só o serviço `rank.record(chatId, senderId)` conta. No legacy, o único chamador era o fluxo da
IA (`LumaPlugin`, `incrementInteraction`), e continua sendo: a [`luma`](luma.md) chama `record` a
cada vez que responde a alguém (uso opcional, `services.has('rank')`, sem `dependsOn`). Sem a
`luma`, o `!rank` responde "Ninguém interagiu comigo ainda".

## Identidade da pessoa

A chave é `personId(contact)`: `${phone}@s.whatsapp.net` quando o transport sabe o `phone`, senão
o `id` cru. No WhatsApp a mesma pessoa chega como LID (`...@lid`) num chat e como número em outro;
sem isso viraria duas linhas. A chave é um JID para o `userNames.displayName` resolvê-la (a
`luma` lembra o nome sob ela).

Migração do histórico: `record(chatId, id, oldId)` soma as contagens antigas de `oldId` (em
`perChat` e `totals`) em `id` e apaga as linhas antigas. Roda quando a pessoa interage de novo
(o `user-names` guarda o mapeamento LID -> telefone no storage dele, que o rank não lê), e é
idempotente: sem linha antiga, não faz nada. LID de quem nunca mais falar fica como está.

As coleções ficam no storage da sessão: com um segundo transport, o global se divide por bot.
Migração: `ctx.storage.shared` com id composto por `ctx.transportName`.

O ranking sai por `ctx.send.send` (sem citar a mensagem), como o `sendText` do legacy; o retorno
do `run` citaria.

## `messages`

`empty`, `titleGroup`, `titleGlobal`, `ranking` (`{title}`, `{lines}`).

## Serviço `rank` (contrato estável)

```ts
record(chatId, senderId, oldId?): Promise<void>
top(scope: { chatId } | 'global', limit): Promise<{ id: string; count: number }[]>
```

`record` usa o `increment` atômico da `Collection` (com `insert` quando não há linha), então
chamadas simultâneas, mesmo entre processos, não duplicam linha nem perdem contagem. Empate no
`top` segue quem chegou primeiro.

Cada coleção é atômica, mas `perChat` e `totals` são dois incrementos separados: se o segundo
falhar, o total fica abaixo da soma dos chats.

Nomes vêm de `userNames.displayName` quando o serviço existe (`services.has`, sem `dependsOn`);
sem ele, `@` + 6 últimos dígitos do id.

## Pontos de extensão

Nenhum: não há variação prevista. Se aparecer (ex.: outra fonte de contagem),
vira um ponto `rank.<ponto>` sem mudar o contrato do serviço.
