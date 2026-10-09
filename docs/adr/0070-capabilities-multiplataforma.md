# ADR 0070 — Capabilities multiplataforma: `typing`, reações, enquetes e a lista do core

**Status:** Aceito (2026-10-09) · Detalha **D10** ([ADR 0010](0010-capabilities-do-transporte.md))
e **D16** ([ADR 0016](0016-manifesto-do-plugin.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

A lista de capabilities nasceu com o que o WhatsApp faz (#284), e o `isCapability` recusa qualquer
nome fora dela. Pontos com formato de WhatsApp:

- **`presence`** mistura o status online global (`available`/`unavailable`, sem sentido por chat)
  com o "digitando" (`composing`, `recording`, `paused`). O Discord só tem "digitando", que dura
  cerca de 10 s e não para; o Telegram tem o `sendChatAction` (`typing`, `record_voice`...), que
  dura cerca de 5 s e também não para.
- **Enquetes:** `selectableCount` é um número, mas o Telegram (`allows_multiple_answers`) e o
  Discord (`allow_multiselect`) só têm "uma ou várias". Não há evento de voto.
- **Reações:** `react(key, null)` remove, mas o Discord exige o emoji para remover e aceita várias
  reações por usuário. O Telegram tem um conjunto fixo de emojis, e o bot põe uma só.
- Faltariam conceitos: botões, threads, mensagem efêmera, apagar ou editar mensagem de outros,
  limites de tamanho, várias mídias e formatação.

A investigação respondeu às perguntas da issue:

- **Boa parte já foi decidida em outros ADRs.** Botões são a capability `actions` (ADR 0062);
  limites de texto, legenda, botões e álbum ficam em `Transport.limits` (ADR 0061, ADR 0065);
  várias mídias, em `attachments` e `send.album` (ADR 0065); formatação, na árvore neutra sem
  capability (ADR 0061); thread e tópico, no `chat.id` opaco com `kind: 'thread'` (ADR 0058).
- **Limites não são capability.** Capability diz se a plataforma faz algo, e o `requires` do
  plugin a confere no boot. O limite é um número que a fila usa a cada envio, e já mora em
  `Transport.limits`. Uma capability com valor misturaria as duas coisas.
- **`typing` sem quebrar a humanização.** A fila só usa `composing` antes de texto e `recording`
  antes de voz (`outbound/queue.ts`). Trocar o tipo por `'text' | 'voice'` mantém o comportamento.
  O `maxMs` padrão (3 s) já cabe nos 5 s do Telegram.
- **Plugin específico de plataforma.** O manifesto já tem `transports: ['discord']` (ADR 0016). Um
  plugin que só roda no Discord usa o `native` ou o `raw` (ADR 0011, ADR 0066), e não precisa de
  capability própria.
- **Apagar e editar mensagem de outros.** As três plataformas apagam a mensagem de outra pessoa
  quando o bot é admin ou tem a permissão; o Baileys já faz isso pelo `delete`. Nenhuma edita a
  mensagem de outra pessoa.
- **Mensagem efêmera.** No Discord, só a resposta a uma interação; no WhatsApp, é configuração do
  chat; o Telegram não tem. Sem leitura comum hoje.
- **O que depende do ponto.** `capabilities.ts`, `types.ts` do transport e do outbound, a fila
  (humanização), as ações do `ctx.send`, o `ctx.reply.poll`, os dois fakes de transport, o
  `FakeTransport` do kit, o Baileys (`sendTyping`, `toContent` da enquete) e as docs.

Alternativas consideradas:

- **Manter `presence` e só estreitar o tipo** para `composing | recording`. Menos renome, mas o
  nome continua sugerindo status online, e o termo `composing` é do WhatsApp.
- **Acrescentar `typing` ao lado de `presence`.** Aditivo, mas deixa dois caminhos para o mesmo
  indicador, e a humanização teria de escolher entre eles.
- **`unreact(key, emoji)` explícito**, com várias reações por mensagem. Quebra a API, e o WhatsApp
  e o Telegram ignorariam o emoji ao remover.
- **Expor o conjunto de emojis permitido** (`limits.reactions`). Aditivo; entra quando um plugin
  precisar escolher o emoji antes de enviar.
- **Manter `selectableCount`**, com o transport sem contagem tratando `> 1` como múltipla escolha.
  O número mentiria fora do WhatsApp.
- **Evento de voto agora** (`poll.vote`). Nenhum transport o emitiria: no Baileys, o voto chega
  cifrado e exige guardar a enquete de origem para decifrar. Entra por adição, com issue própria.
- **Capabilities com namespace de fornecedor** (`x-discord.*`), aceitas pelo `isCapability`. O
  `transports` do manifesto já cobre o plugin específico, e o namespace pode entrar depois sem
  quebrar.

## Decisão

- **`presence` vira `typing`.** A capability `presence` sai da lista e entra `typing`. O método do
  transport `sendPresence(chatId, Presence)` vira `sendTyping(chatId, kind)`, com
  `TypingKind = 'text' | 'voice'`; o `ctx.send.presence` vira `ctx.send.typing`, e a opção
  `outbound.onPresenceError` vira `onTypingError`. Saem `available`/`unavailable` (status global,
  pelo `ctx.unsafe.native`) e `paused` (Discord e Telegram não param o indicador; o envio já o
  limpa). Onde a plataforma não distingue voz (Discord), `voice` mostra "digitando".
- **Reação: uma da sessão por mensagem.** A assinatura não muda. Um emoji novo substitui o
  anterior, e `null` remove a da sessão. O transport do Discord tira as reações anteriores da
  própria sessão. Emoji que a plataforma não aceita rejeita com `retryable: false`.
- **Enquete: `multiple?: boolean`** no lugar de `selectableCount?: number`, no `OutgoingContent` e
  no `ctx.reply.poll`. O Baileys manda `selectableCount` 0 (quantas quiser) ou 1. Quiz, enquete
  anônima e duração ficam no `native`. O evento de voto vira issue própria (#312).
- **A lista é só a do core.** Capability nova entra numa minor do `@zapforge/core`; o
  `isCapability` continua recusando nome desconhecido. Limites ficam em `Transport.limits`.
- **Apagar mensagem de outros** não ganha capability: `delete` documenta que exige admin ou a
  permissão da plataforma e rejeita com `retryable: false` sem ela. **Mensagem efêmera** fica para
  quando houver transport que a use.
- **A §6.10 do plano vira uma matriz por transport**, com o que o Baileys declara e o previsto para
  Telegram, Discord e web.

## Consequências

- Quebra de API antes do 1.0 (D27), registrada nos changesets:
  - plugins trocam `requires: ['presence']` por `['typing']` e `ctx.send.presence(chat, 'composing')`
    por `ctx.send.typing(chat, 'text')`;
  - transports implementam `sendTyping` no lugar de `sendPresence`;
  - quem envia enquete troca `selectableCount` por `multiple`;
  - o app troca `outbound.onPresenceError` por `onTypingError`;
  - o `FakeTransport` do kit grava em `typing` (`{ chatId, kind }`) e não em `presences`.
- No WhatsApp nada muda no comportamento: o Baileys manda `composing` e `recording` como antes, e a
  reação já era uma por pessoa. Uma enquete com `selectableCount` maior que 1 não tem mais
  equivalente: vira "quantas quiser".
- O status online global do WhatsApp sai do contrato. Quem o usava passa pelo socket nativo.
- Custo por mensagem: nenhum. A humanização segue decidida uma vez, na criação da fila.
