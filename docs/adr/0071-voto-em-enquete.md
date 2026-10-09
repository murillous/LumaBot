# ADR 0071 — Voto em enquete: o evento `poll.vote`

**Status:** Aceito (2026-10-09) · Completa **D70** ([ADR 0070](0070-capabilities-multiplataforma.md))
na parte da enquete · Segue **D38** ([ADR 0038](0038-filtro-de-eventos-no-kernel.md)) · Parte do
kernel multiplataforma ([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O contrato envia enquete (`polls`, `multiple?: boolean`), mas o voto não chega ao plugin (#312). O
ADR 0070 deixou o evento de fora porque nenhum transport o emitiria ainda. A investigação:

- **WhatsApp (Baileys 7.0.0-rc14).** O voto chega em `messages.upsert` como `pollUpdateMessage`,
  cifrado com o `messageSecret` da enquete, que só vem na mensagem que a criou. O Baileys tinha a
  decifragem no `process-message`, mas o trecho está comentado nesta versão: o voto chega cru. O
  `getAggregateVotesInPollMessage` só soma votos já decifrados, e o `getMessage` exigiria um
  armazém de mensagens que o transport não tem. A chave sai do JID de quem criou e de quem votou,
  como o aparelho do votante os viu: com LID, pode ter sido o telefone ou o LID. Cada voto traz a
  escolha inteira (SHA-256 do texto de cada opção marcada); a lista vazia é o voto retirado.
- **Telegram.** `poll_answer` traz `option_ids` (a escolha inteira; vazio quando retirado), mas só
  em enquete não anônima. O `sendPoll` é anônimo por padrão.
- **Discord.** `MESSAGE_POLL_VOTE_ADD` e `MESSAGE_POLL_VOTE_REMOVE` trazem uma opção por evento
  (`answer_id`, a partir de 1), não a escolha inteira.
- **Filtros.** O voto é de um chat e de um autor, como a reação: o `chatFilter`, o `ignoreSelf` e o
  `ignoreBots` cabem do mesmo jeito.

Alternativas consideradas:

- **Opções por texto** em vez de índice. O Telegram e o Discord só mandam o ID da opção, e o texto
  exigiria guardar a enquete em todos; dois textos iguais também ficariam ambíguos.
- **A diferença** (`added`/`removed`) em vez da escolha inteira. É o que o Discord manda, mas o
  WhatsApp e o Telegram mandam a escolha inteira, e quem conta votos quer o estado, não o delta.
- **Guardar as enquetes no storage**, para decifrar voto de enquete anterior ao reinício. Poria o
  segredo de cada enquete em disco e cresceria sem limite; entra se um plugin precisar.
- **Capability nova** (`polls.votes`). Nenhuma plataforma-alvo envia enquete sem receber o voto
  dela; a enquete anônima do Telegram é escolha de quem a envia, pelo `native`.

## Decisão

- **Evento `poll.vote`** em `TransportEvents`, com `{ chat, messageId, sender, options, fromMe }`.
  `messageId` é o da enquete; `options` são os índices das opções marcadas, a partir de 0, na ordem
  em que a enquete as listou, sem repetição e em ordem crescente. O evento traz a escolha inteira de
  quem votou: um voto novo substitui o anterior, e `[]` é o voto retirado.
- **Filtros do ADR 0038.** O kernel trata `poll.vote` como a `reaction`: o `chatFilter` barra pelo
  `chat.id` ou `chat.parentId`, o `ignoreSelf` barra `fromMe: true` e o `ignoreBots` barra
  `sender.isBot`. Espera o fim do boot e não entra na fila do chat.
- **Baileys.** O transport guarda num `PollBook` as enquetes que envia e as que recebe (`notify`),
  pelo ID da mensagem, com o segredo e o hash de cada opção. O limite é de 1000 enquetes; a mais
  antiga sai primeiro. O `disconnect()` esvazia o livro, e a reconexão o mantém. O voto passa pela
  mesma fila das mensagens e é decifrado com `decryptPollVote`, tentando cada par de JIDs
  conhecido (telefone e LID de quem criou e de quem votou). Voto de enquete desconhecida é
  descartado com log em debug; voto que não decifra vai ao log de erro. Hash que a enquete não tem
  fica de fora dos índices.
- **Telegram e Discord** (quando nascerem). O Telegram envia a enquete não anônima por padrão, para
  receber o `poll_answer`. O Discord converte `answer_id` em índice e monta a escolha inteira pelos
  eventos de adição e remoção que viu.

## Consequências

- Mudança aditiva: transports existentes seguem válidos sem emitir o evento, e o
  `BotEventName` ganha `poll.vote`.
- No WhatsApp, voto de enquete enviada antes da conexão atual (ou antes do reinício) não chega: o
  segredo dela não está no livro. O plugin que apura votos por muito tempo guarda a apuração no
  próprio storage a cada evento.
- No Discord, depois de reiniciar, a escolha de uma enquete com várias respostas pode sair
  incompleta até o votante mudar o voto de novo.
- Custo por mensagem: uma consulta ao conteúdo para ver se é enquete ou voto. O voto custa até
  quatro tentativas de AES-GCM, uma por par de JIDs.
