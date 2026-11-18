# rank

Ranking de quem mais usa a Luma. Dados no storage do próprio plugin (coleções
`usesPerChat` e `usesTotal`; o total é separado para o `!rank global` não somar todos os chats).

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

Toda ação feita a pedido de alguém: figurinha, download, PDF, transcrição, busca, lembrete,
resumo, resposta da IA. O `rank` contribui um observer ao ponto `usage.observers` do
[`usage`](usage.md) e chama `record` em cada registro com `outcome: ok`; recusa e falha não
somam. A lista do que conta e do que não conta (consultas como `!help`) está no `usage`. Sem o
`usage`, o `!rank` responde "Ninguém me usou ainda".

A pessoa é o `actor` do `usage`, o `personId` (veja abaixo): no WhatsApp a mesma pessoa chega
pelo LID num chat e pelo número em outro, e conta como uma só.

O ranking antigo (coleções `perChat` e `totals`) contava só as respostas da IA, pelo `sender.id`.
Ele recomeça do zero: o `setup` apaga essas coleções a cada boot (ficam vazias depois do
primeiro).

## Identidade da pessoa

A chave é `personId(contact)` (`src/plugins/ai/person-id.ts`): `${phone}@s.whatsapp.net` quando o
transport sabe o `phone`, senão o `id` cru. No WhatsApp a mesma pessoa chega como LID
(`...@lid`) num chat e como número em outro; sem isso viraria duas linhas. A chave é um JID
para o `userNames.displayName` resolvê-la: o `user-names` guarda nome e apelido sob o `id` cru
e sob o `personId`.

**Histórico zerado:** na troca de chave o rank foi zerado uma vez (marca `identityV2` no kv do
plugin; nos boots seguintes não zera de novo). Misturar as chaves antigas (id cru) com as novas
contaria a mesma pessoa em dobro, e o dono preferiu zerar a migrar: o storage do `user-names`,
onde está o mapeamento LID -> telefone, não é legível pelo rank.

As coleções ficam no storage da sessão: com um segundo transport, o global se divide por bot.
Migração: `ctx.storage.shared` com id composto por `ctx.transportName`.

O ranking sai por `ctx.send.send` (sem citar a mensagem), como o `sendText` do legacy; o retorno
do `run` citaria.

## `messages`

`empty`, `titleGroup`, `titleGlobal`, `ranking` (`{title}`, `{lines}`).

## Serviço `rank` (contrato estável)

```ts
record(chatId, senderId): Promise<void>
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
