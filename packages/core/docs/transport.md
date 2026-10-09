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
  readonly limits?: TextLimits;                  // opcional: tamanho de texto e legenda, botões

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
| `interaction` | `{ id, chat, sender, actionId, timestamp }` (clique num botão; ver [Botões](#botões)) |

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
- `TransportDeps` só cresce por adição: desestruture o que usa.

## Envio

```ts
await transport.send(chatId, { type: 'text', text: 'oi @fulano' }, {
  quoted: ctx.message,           // responde citando (capability `quoted`)
  mentions: ['5511999@s.whatsapp.net'], // capability `mentions`
});
await transport.send(chatId, { type: 'image', media: buffer, caption: 'legenda' });
await transport.send(chatId, { type: 'document', media: { url }, fileName, mimetype });
await transport.send(chatId, { type: 'poll', name: 'Pizza?', options: ['sim', 'não'] });
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

### Texto da entrada

Entregue `message.text` como a pessoa o lê, com as menções legíveis (no Discord, `<@123>` vira
`@nome`), e os mencionados em `message.mentions`.

`send` devolve a `MessageKey` da mensagem criada. Para agir sobre uma mensagem recebida, use
`messageKey(message)`:

```ts
import { messageKey } from '@zapforge/core/adapter';
await transport.react(messageKey(ctx.message), '👍');
```

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
`send.text`, `send.image`, `send.video`, `send.audio`, `send.voice`, `send.sticker`, `send.document`, `media.download`,
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
