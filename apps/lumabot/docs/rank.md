# rank

Ranking de quem mais interage com a Luma. Dados no storage do próprio plugin (coleções
`perChat` e `totals`; o total é separado para o `!rank global` não somar todos os chats).

## Comandos

| Comando | O que faz |
| --- | --- |
| `!rank` | Top 10 do grupo; em conversa privada, sempre o global (como o legacy) |
| `!rank global` | Top 10 somando todos os chats |

## Quem conta

Só o serviço `rank.record(chatId, senderId)` conta. No legacy, o único chamador era o fluxo da
IA (`LumaPlugin`, `incrementInteraction`); não há outra fonte. **Hoje nada chama `record`**: o
plugin `ai` (M5) vai chamar. Até lá o `!rank` responde "Ninguém interagiu comigo ainda", e por
isso a linha do `PARIDADE.md` segue desmarcada.

As coleções ficam no storage da sessão: com um segundo transport, o global se divide por bot.
Migração: `ctx.storage.shared` com id composto por `ctx.transportName`.

O ranking sai por `ctx.send.send` (sem citar a mensagem), como o `sendText` do legacy; o retorno
do `run` citaria.

## `messages`

`empty`, `titleGroup`, `titleGlobal`, `ranking` (`{title}`, `{lines}`).

## Serviço `rank` (contrato estável, ADR 0002)

```ts
record(chatId, senderId): Promise<void>
top(scope: { chatId } | 'global', limit): Promise<{ id: string; count: number }[]>
```

`record` é serializado no processo (cadeia de promessas), então chamadas simultâneas não
duplicam linha nem perdem contagem. Entre processos (dois bots sobre o mesmo banco) ainda há
corrida: a `Collection` do Bridger não tem incremento atômico nem upsert. Empate no `top` segue quem chegou primeiro.

Nomes vêm de `userNames.displayName` quando o serviço existe (`services.has`, sem `dependsOn`);
sem ele, `@` + 6 últimos dígitos do id.

## Pontos de extensão

Nenhum: não há variação prevista (ADR 0002 item 2). Se aparecer (ex.: outra fonte de contagem),
vira um ponto `rank.<ponto>` sem mudar o contrato do serviço.
