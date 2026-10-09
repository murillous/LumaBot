# Transport

O `Transport` é a porta entre o kernel e um canal de mensageria (WhatsApp via Baileys, Cloud
API etc.). O core só conhece a interface; cada adapter traduz o formato nativo para os tipos
normalizados. Porquê: [ADR 0003](../../../docs/adr/0003-transport-abstrato.md),
[ADR 0010](../../../docs/adr/0010-capabilities-do-transporte.md),
[ADR 0011](../../../docs/adr/0011-escape-hatch-unsafe-native.md).

## A interface

```ts
import type { Transport } from '@zapforge/core/adapter';

interface Transport {
  readonly name: string;                         // 'baileys'
  readonly capabilities: ReadonlySet<Capability>;
  readonly self: Contact | null;                 // null até a primeira conexão aberta
  readonly native: unknown;                      // escape hatch (ctx.unsafe.native)
  raw?(source: Message | Interaction): unknown;  // opcional: objeto bruto (ctx.unsafe.raw)
  readonly limits?: TextLimits;                  // opcional: tamanho de texto e legenda, botões
  readonly pacing?: TransportPacing;             // opcional: ritmo padrão da fila de saída

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event, handler): Unsubscribe;

  send(chatId, content, options?): Promise<MessageKey>;
  react(key, emoji | null): Promise<void>;       // reactions
  edit(key, text, formatted?): Promise<void>;    // message.edit
  delete(key): Promise<void>;                    // message.delete
  sendPresence(chatId, presence): Promise<void>; // presence
  getGroupMetadata(groupId): Promise<GroupMetadata>;            // groups
  isChatAdmin?(chat, contact): Promise<boolean>;                // opcional
  updateGroupParticipants(groupId, ids, action): Promise<void>; // groups.add/remove/promote
}
```

`connect()` inicia uma tentativa de conexão e resolve assim que ela começou (socket criado), sem
esperar o `open`; rejeita só se nem deu para começar. O resto chega por `connection.status`
([ADR 0048](../../../docs/adr/0048-connect-resolve-ao-iniciar.md)):

- `open` quando dá para enviar. O `Bot` só despacha a fila de saída depois do primeiro `open`:
  um transport que nunca o emite não envia nada.
- `closed` se a tentativa cair, inclusive antes de o `connect()` resolver (no Baileys, o restart
  pedido pelo servidor logo depois do pareamento). O `Bot` guarda essa queda e reconecta quando o
  `connect()` termina, a menos que um `open` venha depois dela.

`disconnect()` tem de ser seguro e idempotente: resolve sem lançar se chamado sem `connect()`,
após um `connect()` que falhou ou que ainda não terminou, ou mais de uma vez. O shutdown do
`Bot` conta com isso.

Todo método existe em todo transport. O que o canal não suporta lança `UnsupportedError`;
quem chama checa a capability antes (ver abaixo).

## Ids de contato

Os ids de contato (`sender.id`, `GroupParticipant.id`, `mentions`, os ids de
`updateGroupParticipants`) podem vir em espaços diferentes. No WhatsApp, o mesmo contato aparece
como LID (`123@lid`) num lugar e como JID de telefone (`5511999999999@s.whatsapp.net`) em outro,
conforme o modo de endereçamento do grupo. O que liga os dois é o `phone`:

- O adapter preenche `phone` (só dígitos, com DDI) no remetente, nos participantes e no
  `transport.self` sempre que souber resolvê-lo; `null` só quando não souber.
- Para saber se dois contatos são o mesmo, compare o `id` e, se os dois tiverem, o `phone`. É o
  que o kernel faz no `role: 'group-admin'`
  ([ADR 0046](../../../docs/adr/0046-ids-de-contato-e-metadata-de-grupo.md)). Os `owners` da
  config dizem qual dos dois comparar: telefone com `phone`, `{ id }` com `id`.
- `username` e `isBot` vão no remetente, nos participantes e no `transport.self` quando a
  plataforma informa. Marque `isBot: true` nos outros bots: é o que o `ignoreBots` lê para evitar
  loop entre bots. `claims` só vai no contato que fez a ação, e só com o que o transport
  verificou ([ADR 0057](../../../docs/adr/0057-contact-multiplataforma.md)).

- O `chat.id` precisa apontar para onde a resposta deve cair: no Telegram, componha o chat e o
  tópico (`message_thread_id`) e decomponha no envio. `parentId` é o espaço (servidor do
  Discord, supergrupo do Telegram), e `kind`/`title` vão quando a plataforma informa
  ([ADR 0058](../../../docs/adr/0058-chat-multiplataforma.md)).

## Eventos

Os eventos chegam já normalizados (`TransportEvents`):

| Evento | Payload |
| --- | --- |
| `message` | `Message` |
| `message.edited` | `Message` (nova versão, `isEdited: true`) |
| `message.deleted` | `{ chat, messageId, deletedBy, fromMe }` (`fromMe`: apagada pela própria sessão) |
| `reaction` | `{ chat, messageId, sender, emoji, fromMe }` (`emoji: null` = removida; `fromMe`: reação da própria sessão) |
| `group.joined` / `group.left` | `{ chat }` (o bot entrou/saiu; no Discord, `chat` é o servidor) |
| `group.participants` | `{ chat, action, participants, actor }` |
| `group.updated` | `{ chat, title?, description?, announce?, restrict? }` |
| `contact.updated` | `{ id, name?, phone? }` (nome ou telefone de um contato mudou; só os campos alterados) |
| `connection.status` | `{ status: 'connecting' \| 'open' }` ou `{ status: 'closed', reason, error }` |
| `connection.qr` | `{ qr }` |
| `connection.pairing-code` | `{ code }` (código de pareamento, a alternativa ao QR; quem pareia por código não emite `connection.qr`) |
| `interaction` | `{ id, chat, sender, actionId, timestamp }` (clique num botão; ver [Botões](#botões)) ou `{ id, chat, sender, command, args, timestamp }` (comando nativo; ver [Comandos nativos](#comandos-nativos)) |

`message:<type>` e `plugin.error` (plano §6.4) são gerados pelo kernel, não pelo transport.

```ts
const off = transport.on('reaction', ({ messageId, emoji }) => { ... });
off(); // idempotente
```

As assinaturas vivem na instância do transport: nada de estado global.

### Implementando `on()` num adapter

Use o `TypedEmitter`. Um handler que lança ou rejeita não interrompe os demais nem sobe para
o adapter: o erro vai para o `onError` passado no construtor.

```ts
import { TypedEmitter, type TransportEvents } from '@zapforge/core/adapter';

class BaileysTransport implements Transport {
  readonly #events = new TypedEmitter<TransportEvents>((error, event) =>
    this.#log.error({ error, event }, 'handler de evento falhou'),
  );

  on: Transport['on'] = (event, handler) => this.#events.on(event, handler);

  #onUpsert(raw: proto.IWebMessageInfo) {
    this.#events.emit('message', toMessage(raw));
  }
}
```

## Adapter com fábrica

Um adapter que precisa do bot (credenciais, logger) exporta uma fábrica, não a classe:
`BotConfig.transport` aceita `(deps: TransportDeps) => Transport`
([ADR 0037](../../../docs/adr/0037-transport-por-fabrica.md); uso em
[Bot → Transport por fábrica](bot.md#transport-por-fábrica)).

```ts
import type { Transport, TransportDeps } from '@zapforge/core/adapter';

export function baileys(options: BaileysOptions): (deps: TransportDeps) => Transport {
  // Valide `options` aqui: um erro na fábrica vira `BotConfigError` no `createBot`.
  return ({ session, auth, log }) => new BaileysTransport(options, { session, auth, log });
}
```

- `auth` é o `AuthStateStore` da sessão (`getCreds`/`setCreds`/`getKeys`/`setKeys`/`clear`): o
  adapter converte o formato nativo para JSON e guarda ali, sem arquivo próprio.
- `log` já vem com `{ transport: name }` e passa pela censura de segredos do bot. Antes do
  `start()` descarta as linhas; guarde a referência, ela passa a valer sozinha.
- A fábrica roda dentro do `createBot`, que não pode ter efeito colateral (ADR 0004): **só monte o
  objeto**. Socket, timer, leitura de credenciais e qualquer I/O ficam no `connect()`. O
  transport sai da fábrica pronto para `connect()`, sem passo de inicialização extra.
- `commands` é a lista de comandos do bot, para o menu nativo da plataforma (ver
  [Comandos nativos](#comandos-nativos)).
- `TransportDeps` só cresce por adição: desestruture o que usa.

## Comandos nativos

Onde a plataforma tem menu de comandos (slash commands do Discord, `setMyCommands` do Telegram,
menu do web), o transport registra os comandos do bot a partir de `deps.commands`
([ADR 0064](../../../docs/adr/0064-comandos-nativos.md)):

- `list()` devolve os comandos registrados agora (`plugin`, `name`, `aliases`, `description`,
  `role`), como o `ctx.commands.list()` dos plugins;
- `onChange(listener)` avisa que a lista mudou e devolve a função que desfaz a assinatura.

O boot dos plugins termina antes do `connect()`, então a lista já está completa no primeiro
`open`. Depois, o aviso chega uma vez ao fim de cada reload de plugin e uma vez por tick para os
comandos adicionados fora dele. O `stop()` não avisa: o `teardown` tira os comandos, mas o menu
da plataforma fica como estava para a próxima subida. O aviso não traz a lista: compare `list()`
com o que já registrou e só chame a plataforma se mudou (o Discord limita a taxa de registro).

```ts
return ({ log, commands }) => {
  const transport = new DiscordTransport(options, log);
  // `commands` é opcional para quem monta o `TransportDeps` à mão (testes).
  if (commands) {
    transport.onOpen(() => transport.syncCommands(commands.list()));
    commands.onChange(() => transport.syncCommands(commands.list()));
  }
  return transport;
};
```

Um listener que lança, ou cuja promise rejeita, vai para o log do bot. Trate a falha da
plataforma no próprio transport, se quiser tentar de novo.

O que registrar:

- **Só o `name`.** O alias segue funcionando digitado, e o menu não fica poluído (o Discord
  aceita 100 comandos globais).
- **O `role` decide quem vê o comando.** `everyone` para todos; `group-admin` só para admins,
  onde a plataforma permite (`default_member_permissions` no Discord, escopo
  `all_chat_administrators` no Telegram); `owner` e papéis custom ficam fora do menu. O kernel
  checa o papel na execução de todo jeito.
- **Argumentos em texto livre.** No Discord, uma opção de texto opcional (`args`) por comando.
  O nome e a descrição seguem as regras da plataforma: ajuste ou pule, com log, o que ela não
  aceita (`description` `null` precisa de um texto padrão no Discord).

Quando a plataforma entrega o comando estruturado, como o slash command do Discord, confirme a
interação na hora e emita `interaction` com `command` e `args`:

```ts
// No INTERACTION_CREATE do Discord, tipo APPLICATION_COMMAND:
await interaction.deferReply(); // dentro dos 3 s, antes de entregar
emitter.emit('interaction', {
  id: interaction.id,           // vira o ID da mensagem do comando; o `ctx.reply` a cita
  chat: toChat(interaction.channel),
  sender: toContact(interaction.user),
  command: interaction.commandName, // nome ou alias, sem prefixo
  args: interaction.options.getString('args') ?? '',
  timestamp: Date.now(),
});
```

O kernel roda o comando como o digitado, sem prefixo: mesma fila do chat, middlewares, papel,
recusa e evento `command`. O `args` é interpretado como o texto depois do comando (aspas,
`rawArgs`), e a mensagem do comando tem o texto `/<command> <args>`. Comando que não existe mais
é descartado com log em `debug`; o transport encerra a interação pendente quando o prazo dela
vencer. No Telegram, o comando chega como texto comum (`/start@MeuBot`), pelo evento `message`,
e o roteador trata o prefixo ([ADR 0063](../../../docs/adr/0063-prefixo-por-chat.md)).

A resposta do plugin chega por `send` com `quoted` igual à mensagem do comando (`id` = o `id` da
interação), pela fila de saída. Responda como follow-up enquanto a plataforma aceitar (15 min no
Discord) e, depois, como mensagem comum no chat. A `MessageKey` devolvida é a da mensagem criada.

## Envio

```ts
await transport.send(chatId, { type: 'text', text: 'oi @fulano' }, {
  quoted: ctx.message,           // responde citando (capability `quoted`)
  mentions: ['5511999@s.whatsapp.net'], // capability `mentions`
});
await transport.send(chatId, { type: 'image', media: buffer, caption: 'legenda' });
await transport.send(chatId, { type: 'document', media: { url }, fileName, mimetype });
await transport.send(chatId, { type: 'poll', name: 'Pizza?', options: ['sim', 'não'] });
await transport.send(chatId, {
  type: 'album',                 // capability `send.album`
  items: [{ type: 'image', media: foto1 }, { type: 'image', media: foto2 }],
  caption: 'legenda',
});
```

### Texto formatado

Quando o plugin usa a árvore neutra ([Texto formatado](text.md), [ADR
0061](../../../docs/adr/0061-texto-formatado-neutro.md)), o conteúdo chega com `formatted` (ou
`formattedCaption`), e `text` (ou `caption`) traz o texto visível dela. O `edit` recebe a árvore
no terceiro parâmetro.

- **Quem conhece o campo** traduz a árvore para a marcação da plataforma. Escape o texto literal
  (as strings da árvore) onde a plataforma tem escape: MarkdownV2 no Telegram, Markdown no
  Discord, HTML no web. Notifique só os contatos dos nós `mention` e de `options.mentions`, e não
  pingue o autor da mensagem citada.
- **Quem não conhece** envia `text`, que já é o texto sem marcação. Nada quebra.
- **Sem `formatted`**, `text` é cru: vai como veio. No web, trate-o como texto, nunca como HTML.

```ts
import type { FormattedText, TextNode } from '@zapforge/core';

function render(nodes: readonly TextNode[]): string {
  return nodes
    .map((node) => {
      if (typeof node === 'string') return escape(node);
      switch (node.type) {
        case 'bold':
          return `**${render(node.children)}**`;
        // italic, code, link, mention…
      }
    })
    .join('');
}
```

### Limites de tamanho

`limits` declara o tamanho máximo da plataforma. A fila de saída divide o texto e a legenda acima
dele, e o transport nunca recebe uma parte maior, a não ser um único caractere ou uma menção maior
que o limite.

```ts
readonly limits = {
  text: 2000,
  // Opcional: como a plataforma conta. Sem ele, conta o texto visível em UTF-16.
  measure: (text: MessageText) => renderDiscord(text).length,
};
```

O Telegram conta o texto visível, então o padrão serve (`{ text: 4096, caption: 1024 }`). O
Discord conta a marcação (`**`, `<@id>`) e precisa do `measure`. Sem `limits`, nada é dividido:
é o caso do WhatsApp. Um limite que não é inteiro ≥ 1 faz o `createBot` lançar `RangeError`.

### Botões

Com a capability `actions`, o `SendOptions.actions` traz os botões da mensagem, na ordem, como
`{ id, label }` ([ADR 0062](../../../docs/adr/0062-acoes-e-botoes.md)). Eles só vêm com
`type: 'text'`, e num texto dividido, só na última parte. O transport os renderiza do jeito da
plataforma (teclado inline no Telegram, componentes no Discord, botões ou lista no WhatsApp
oficial).

O `id` é opaco, com até 16 caracteres ASCII, e cabe no `callback_data` de 64 bytes do Telegram. O
clique volta pelo evento `interaction`:

```ts
// No callback_query do Telegram, por exemplo:
await api.answerCallbackQuery(query.id); // confirma na hora, antes de entregar
emitter.emit('interaction', {
  id: query.id,                 // vira o ID da mensagem do clique; o `ctx.reply` a cita
  chat: toChat(query.message.chat),
  sender: toContact(query.from),
  actionId: query.data,         // o `id` do botão, como o kernel o enviou
  timestamp: Date.now(),
});
```

A confirmação é do transport: o kernel processa o clique na fila do chat, sem prazo de
plataforma. A resposta do plugin chega por `send` com `quoted` igual à mensagem do clique (`id` =
o `id` da interação), e o transport decide como responder a ela (follow-up no Discord, mensagem
nova no Telegram).

`limits.actions` diz quantos botões cabem numa mensagem (no WhatsApp Cloud API, 3). Acima dele, ou
sem a capability, o kernel envia o menu em texto numerado e o transport não vê botão nenhum. Um
limite que não é inteiro ≥ 1 faz o `createBot` lançar `RangeError`.

### Álbum

Com a capability `send.album`, o transport recebe `{ type: 'album', items, caption? }`, com os
itens `image`, `video` ou `document` na ordem
([ADR 0065](../../../docs/adr/0065-varios-anexos-e-albuns.md)). A fila nunca entrega menos de
dois itens nem mais que `limits.album`, e só entrega o álbum a quem declara a capability: sem
ela, envia item a item.

```ts
readonly capabilities = new Set<Capability>(['send.image', 'send.document', 'send.album' /* ... */]);
readonly limits = { album: 10 }; // sendMediaGroup do Telegram, anexos do Discord
```

O que a plataforma não aceita junto é do transport. No Telegram, documento não se mistura com foto
ou vídeo: separe em dois `sendMediaGroup`, a legenda no primeiro, e devolva a chave do primeiro.
Um transport com `switch` exaustivo sobre `content.type` precisa do caso `album` mesmo sem a
capability, nem que seja para lançar `UnsupportedError`.

### Vários anexos na entrada

Entregue todas as mídias da mensagem em `attachments` ([Mensagem](message.md#vários-anexos)). O
`type` é o do primeiro anexo. O álbum do Telegram chega como vários updates com o mesmo
`media_group_id`: junte-os no transport e emita uma `message` só. Espere uma janela curta
(algumas centenas de ms) desde o último update do grupo, e limpe os timers no `disconnect()`, para
nada ser emitido depois dele. O core não conhece o `media_group_id`.

### Objeto bruto da entrada

Implemente `raw(source)` para o `ctx.unsafe.raw()` devolver o objeto de onde a mensagem saiu
([ADR 0066](../../../docs/adr/0066-objeto-bruto-da-mensagem.md), [escape hatch](unsafe.md)): o
`WAMessage` no Baileys, a `Message` do discord.js, o `Update` no Telegram. Guarde o objeto num
`WeakMap` da instância, chaveado pela `Message` ou pela `Interaction` que você emitiu:

```ts
readonly #raws = new WeakMap<Message | Interaction, unknown>();

// ao normalizar, antes de emitir (também a citada e a versão editada):
const message = createMessage(init);
this.#raws.set(message, update);

raw(source: Message | Interaction): unknown {
  return this.#raws.get(source); // undefined para o que não saiu daqui
}
```

- O `WeakMap` some com a mensagem: nada a limpar no `disconnect()`. Não ponha o objeto num campo
  da `Message`: ele apareceria em spread e em `JSON.stringify`.
- Registre também a `Interaction` (clique ou comando nativo): o kernel monta a mensagem dela, e o
  `raw()` dessa mensagem chega ao transport como a própria `Interaction`. É onde mora o token de
  interação do Discord e a `callback_query` do Telegram.
- Sem `raw`, o `ctx.unsafe.raw()` devolve `undefined`. Se guardar o objeto custa caro na sua
  plataforma, deixe o método de fora.

### Texto da entrada

Entregue `message.text` como a pessoa o lê, com as menções legíveis (no Discord, `<@123>` vira
`@nome`), e os mencionados em `message.mentions`.

`send` devolve a `MessageKey` da mensagem criada. Para agir sobre uma mensagem recebida, use
`messageKey(message)`:

```ts
import { messageKey } from '@zapforge/core/adapter';
await transport.react(messageKey(ctx.message), '👍');
```

### Erros de envio

A fila de saída re-tenta o que falha ([Fila de saída](outbound-queue.md#erros-e-retry)), a não
ser que o erro diga o contrário. Lance o erro nativo enriquecido com dois campos opcionais, sem
classe do core ([ADR 0067](../../../docs/adr/0067-retry-after-e-ritmo-do-transport.md)):

- **`retryable: false`**: falha permanente. A fila rejeita na hora, sem segurar o chat com
  re-tentativas que vão falhar igual.
- **`retryAfterMs`**: a plataforma recusou por taxa e disse quando tentar de novo (ms, finito e
  ≥ 0). A fila espera esse tempo, no lugar do backoff. Com **`retryAfterScope: 'global'`**, a
  janela vale para todos os chats, e nenhum envio sai antes dela. Sem o campo, ou com `'chat'`,
  só o chat do envio espera.

```ts
try {
  return await api.sendMessage(chatId, text);
} catch (error) {
  throw Object.assign(error, classify(error)); // ver o mapeamento abaixo
}
```

| Resposta da plataforma | Campos |
| --- | --- |
| 429 com espera (`retry_after` do Discord, em s; `parameters.retry_after` do Telegram, em s) | `retryAfterMs: segundos × 1000`; `retryAfterScope: 'global'` quando a plataforma diz que é global (`global: true` no Discord) |
| 400 (mensagem longa demais, conteúdo inválido) | `retryable: false` |
| 401 e 403 (bot bloqueado pelo usuário, sem permissão: `50013` e `50007` no Discord) | `retryable: false` |
| 404 (chat ou mensagem inexistente) | `retryable: false` |
| 413 (arquivo grande demais) | `retryable: false` |
| 5xx, queda de rede, timeout do cliente HTTP | nenhum: é transitória, e a fila re-tenta com backoff |

Converta a espera para milissegundos: o core não lê `retry_after` nem código de plataforma. Um
`retryAfterMs` inválido (negativo, `NaN`, texto) é ignorado, e vale o backoff. Uma espera acima
de `retry.maxDelayMs` (padrão 30 s) não re-tenta: o envio rejeita com o seu erro.

Um cliente que já respeita a taxa sozinho (o discord.js enfileira por rota) quase não deixa o 429
chegar à fila. Mesmo assim, lance o `retryAfterMs` quando ele chegar.

### Ritmo

`pacing` dá o ritmo padrão da fila de saída para a plataforma
([ADR 0067](../../../docs/adr/0067-retry-after-e-ritmo-do-transport.md)). O que o app passa em
`createBot({ outbound })` sobrescreve cada campo, e o campo ausente cai no padrão do core, a
política anti-ban do WhatsApp (300 ms global, 1000 ms por chat).

```ts
// Telegram: 30 mensagens/s no total e cerca de 1/s por chat privado.
readonly pacing = { globalIntervalMs: 34, chatIntervalMs: 1000 };
// Discord: o discord.js já limita a taxa, e o intervalo do kernel só somaria latência.
readonly pacing = { globalIntervalMs: 0, chatIntervalMs: 0 };
```

O intervalo por chat é um só. O limite mais apertado de um tipo de chat (20 mensagens/min num grupo
do Telegram) chega como 429 com `retryAfterMs`, e a fila espera a janela. Um valor que não é
número finito ≥ 0 faz o `createBot` lançar `RangeError`.

## Grupos

`getGroupMetadata(groupId)` traz `title`, `description`, `ownerId` e `participants` com
`isAdmin` (verdadeiro também para o dono) e `isSuperAdmin`; o próprio bot é `transport.self`.
Onde a plataforma não lista membros (Telegram) ou listar custa caro (servidor grande do
Discord), deixe `participants` ausente. Nunca entregue a lista pela metade: um plugin que
menciona todos agiria sobre ela sem saber
([ADR 0059](../../../docs/adr/0059-grupos-multiplataforma.md)).

O papel `group-admin` pergunta ao transport se o remetente é admin:

1. Com `isChatAdmin(chat, contact)` implementado, só ele responde. Use quando a plataforma decide
   admin de outro jeito (permissão de servidor e de canal no Discord, `getChatMember` no
   Telegram). Ele recebe o `Chat` inteiro, com o `parentId` do servidor.
2. Sem ele, com a capability `groups`, o kernel procura o contato nos `participants` do
   `getGroupMetadata`. Sem `participants`, recusa.
3. Sem nenhum dos dois, `group-admin` recusa quem não é owner.

As alterações de participantes têm uma capability por ação: `groups.add`, `groups.remove` e
`groups.promote` (que vale também para `demote`). Declare só as que a plataforma permite ao bot:
no Telegram e no Discord, bot não adiciona ninguém. `remove` tira a pessoa sem impedir que volte.
`groupActionCapability(action)` diz qual capability cobrar.

O kernel chama `getGroupMetadata` a cada comando `group-admin` de quem não é owner, e o plugin
pode chamá-lo por `ctx.groups.metadata` quando quiser. Por isso ele precisa ser barato: o adapter
mantém cache por grupo e o invalida em `group.participants` e `group.updated` (no Baileys,
`cachedGroupMetadata`). O core não cacheia
([ADR 0046](../../../docs/adr/0046-ids-de-contato-e-metadata-de-grupo.md)).

## Capabilities

`CAPABILITIES` lista as capabilities suportadas pelo kernel (plano §6.10):

`actions`, `groups`, `groups.add`, `groups.remove`, `groups.promote`, `mentions`, `reactions`, `presence`,
`send.text`, `send.image`, `send.video`, `send.audio`, `send.voice`, `send.sticker`, `send.document`, `send.album`, `media.download`,
`message.edit`, `message.delete`, `polls`, `quoted`.

O transport declara o subconjunto que suporta em `capabilities`. Helpers (de
`@zapforge/core/adapter`; o plugin só vê o tipo `Capability` e o `UnsupportedError`, de
`@zapforge/core`):

| Função | Uso |
| --- | --- |
| `hasCapability(t, cap)` | `boolean` |
| `assertCapability(t, cap)` | lança `UnsupportedError` se faltar |
| `missingCapabilities(t, required)` | faltantes de um `requires` (boot do plugin) |
| `capabilitiesForSend(content, options?)` | o que um `send` exige |
| `groupActionCapability(action)` | o que uma alteração de participantes exige |
| `assertCanSend(t, content, options?)` | rede de segurança antes do `send` |
| `isCapability(str)` | valida strings vindas de manifesto em JS |

`UnsupportedError` carrega `capability` e `transport`. O caminho normal é o kernel recusar no
boot o plugin cujo `requires` não fecha; o erro em runtime é a rede de segurança.

## Política de reconexão

`ReconnectionPolicy` decide o que fazer após uma desconexão, sem executar: devolve a ação e o
atraso, e quem a chama aguarda, limpa a sessão e reconecta. No bot isso já está ligado
(`createBot({ reconnection })`, ver [Bot → Reconexão](bot.md#reconexão)); o exemplo abaixo é para
quem usa o transport sem o bot. O adapter mapeia o código nativo
para um `DisconnectReason` (`qr-timeout`, `logged-out`, `auth-failed`, `replaced`,
`server-error`, `connection-lost`, `unknown`). `replaced` é a conexão derrubada por outra da
mesma sessão (no Baileys, `DisconnectReason.connectionReplaced`).

```ts
import { ReconnectionPolicy } from '@zapforge/core/adapter';

const policy = new ReconnectionPolicy({
  backoff: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000), // padrão: 5 s × n, até 15 s
});

transport.on('connection.qr', () => policy.qrPresented());
transport.on('connection.pairing-code', () => policy.qrPresented());
transport.on('connection.status', async (s) => {
  if (s.status === 'open') return policy.connected();
  if (s.status !== 'closed') return;
  const decision = policy.decide(s.reason);
  if (decision.action === 'stop') return encerrar(); // outra conexão assumiu a sessão
  await sleep(decision.delayMs);
  if (decision.action === 'clean-session') await authState.clear();
  await transport.connect();
});
```

| Motivo | Decisão |
| --- | --- |
| `connection-lost`, `unknown` | `reconnect` com backoff, sem limite de tentativas: queda de rede nunca limpa a sessão ([ADR 0045](../../../docs/adr/0045-queda-de-rede-nao-limpa-sessao.md)) |
| `server-error` | `reconnect` com atraso fixo (`serverErrorDelayMs`), sem gastar tentativa |
| `qr-timeout` | `reconnect` (novo QR); após `maxQrCount` QRs, `clean-session` (`qr-limit`) |
| `logged-out`, `auth-failed` | `clean-session` |
| `replaced` | `stop`: não reconectar. Duas conexões do mesmo número se derrubariam em laço ([ADR 0036](../../../docs/adr/0036-escopo-de-sessao.md)) |

`decide()` assume que a decisão será executada e avança o estado. Uma limpeza que viria antes
de `minCleanIntervalMs` da anterior é adiada (o `delayMs` cresce), evitando loop de limpeza.
Relógio (`now`) e estado inicial (`initialState`) são injetáveis; `policy.state` expõe os
contadores para log.
