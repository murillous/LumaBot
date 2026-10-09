# ADR 0058 — `Chat` multiplataforma: tipo, espaço e título

**Status:** Aceito (2026-10-09) · Detalha **D09**
([ADR 0009](0009-modelo-de-mensagem-normalizado.md)), **D24**
([ADR 0024](0024-papeis-no-core.md)) e **D38**
([ADR 0038](0038-filtro-de-eventos-no-kernel.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O `Chat` tinha só `id` e `isGroup` (#269), o formato de um chat do WhatsApp. Fora dele:

- **Telegram** tem privado, grupo, supergrupo, canal de transmissão e tópicos de fórum. O tópico
  não tem ID próprio: é o par `chat_id` + `message_thread_id`. Sem o tópico, um envio cai no
  "General".
- **Discord** tem DM, DM em grupo, canal de servidor, thread e post de fórum. A thread tem ID de
  canal próprio, mas o kernel não sabe a que servidor um canal pertence. O admin (#270) e o
  `chatFilter` precisam disso.
- **Web** tem conversa ou sala, definidas pelo sistema do dono.

Nada carregava o nome do chat.

Editar e apagar não dependem do tópico: no Telegram, `message_id` é único dentro do chat, então
a `MessageKey` não muda.

Alternativas consideradas:

- **`threadId` separado** no `Chat` e na `MessageKey`. Todo alvo de envio (`ctx.send`, o
  scheduler, o `chatId` guardado no storage) teria de carregar dois campos, e quem esquecesse o
  segundo responderia no "General".
- **ID composto com formato do core** (`canal#thread`). O core passaria a interpretar o ID, e o
  formato ficaria preso a uma plataforma.
- **`parentId` como pai imediato** (thread → canal → servidor). O admin e o filtro precisam do
  servidor, e chegar a ele exigiria um segundo campo ou uma consulta ao transport.

## Decisão

- O `Chat` ganha três campos **opcionais**, preenchidos pelo transport quando a plataforma tem a
  informação:
  - `kind?: 'dm' | 'group' | 'channel' | 'thread'` (tipo exportado `ChatKind`). `group` é a
    conversa de várias pessoas solta (grupo do WhatsApp ou do Telegram, DM em grupo do Discord,
    sala do web). `channel` é o canal de servidor do Discord ou o canal de transmissão do
    Telegram. `thread` é a thread ou o post de fórum do Discord, ou o tópico do Telegram.
  - `parentId?: string`: o **espaço** a que o chat pertence, o servidor do Discord (do canal ou
    da thread) ou o supergrupo do Telegram (do tópico). Não é o canal-pai de uma thread: esse
    fica com o transport.
  - `title?: string`: o nome do chat.
- `chat.id` continua **opaco** e aponta para onde a resposta deve cair. No tópico do Telegram, o
  transport compõe o ID do chat e do tópico e o decompõe no envio. O core nunca o interpreta.
- `isGroup` continua obrigatório: verdadeiro em todo chat que não é `dm`. Com `kind` ausente, o
  plugin decide só por ele.
- O `chatFilter` casa `allow` e `block` contra o `chat.id` **ou** o `chat.parentId`. Liberar ou
  bloquear um servidor vale para todos os canais dele. O `block` continua vencendo: um canal
  bloqueado fica de fora mesmo com o servidor liberado. Vale também para `reaction` e
  `message.deleted` (ADR 0038). Os eventos `group.*` só têm o `groupId` e seguem por ele.

## Consequências

- Mudança aditiva: um `Chat` só com `id` e `isGroup` continua válido, e nenhum transport precisa
  mudar. No WhatsApp não há `parentId`, então o filtro age como antes.
- Custo por mensagem: no `chatFilter`, uma consulta a mais no `Set` quando o chat tem
  `parentId`.
- `MessageKey` e `messageKey` não mudam.
- O kit de testes já aceita `receive({ chat: { id, isGroup, kind, parentId, title } })`, porque
  o `chat` do kit é um `Chat` inteiro.
- O admin por servidor (#270) e o prefixo por tipo de chat (#276) partem de `kind` e `parentId`.
  Se um plugin precisar do canal-pai da thread do Discord, ele entra depois como campo novo, sem
  quebrar a API.
