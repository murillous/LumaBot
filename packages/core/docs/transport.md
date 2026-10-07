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

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event, handler): Unsubscribe;

  send(chatId, content, options?): Promise<MessageKey>;
  react(key, emoji | null): Promise<void>;       // reactions
  edit(key, text): Promise<void>;                // message.edit
  delete(key): Promise<void>;                    // message.delete
  sendPresence(chatId, presence): Promise<void>; // presence
  getGroupMetadata(groupId): Promise<GroupMetadata>;            // groups
  updateGroupParticipants(groupId, ids, action): Promise<void>; // groups.admin
}
```

`disconnect()` tem de ser seguro e idempotente: resolve sem lançar se chamado sem `connect()`,
após um `connect()` que falhou ou que ainda não terminou, ou mais de uma vez. O shutdown do
`Bot` conta com isso.

Todo método existe em todo transport. O que o canal não suporta lança `UnsupportedError`;
quem chama checa a capability antes (ver abaixo).

## Eventos

Os eventos chegam já normalizados (`TransportEvents`):

| Evento | Payload |
| --- | --- |
| `message` | `Message` |
| `message.edited` | `Message` (nova versão, `isEdited: true`) |
| `message.deleted` | `{ chat, messageId, deletedBy, fromMe }` (`fromMe`: apagada pela própria sessão) |
| `reaction` | `{ chat, messageId, sender, emoji, fromMe }` (`emoji: null` = removida; `fromMe`: reação da própria sessão) |
| `group.joined` / `group.left` | `{ groupId }` (o bot entrou/saiu) |
| `group.participants` | `{ groupId, action, participants, actor }` |
| `group.updated` | `{ groupId, subject?, description?, announce?, restrict? }` |
| `contact.updated` | `{ id, name?, phone? }` (nome ou telefone de um contato mudou; só os campos alterados) |
| `connection.status` | `{ status: 'connecting' \| 'open' }` ou `{ status: 'closed', reason, error }` |
| `connection.qr` | `{ qr }` |

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

`send` devolve a `MessageKey` da mensagem criada. Para agir sobre uma mensagem recebida, use
`messageKey(message)`:

```ts
import { messageKey } from '@zapforge/core/adapter';
await transport.react(messageKey(ctx.message), '👍');
```

## Grupos

`getGroupMetadata(groupId)` traz `participants` com `isAdmin` (verdadeiro também para o
criador) e `isSuperAdmin`. É o que o roteador usa para `role: 'group-admin'`; o próprio bot
é `transport.self`.

## Capabilities

`CAPABILITIES` lista as capabilities suportadas pelo kernel (plano §6.10):

`groups`, `groups.admin`, `mentions`, `reactions`, `presence`, `send.text`, `send.image`,
`send.video`, `send.audio`, `send.voice`, `send.sticker`, `send.document`, `media.download`,
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
  maxReconnectAttempts: 3,
});

transport.on('connection.qr', () => policy.qrPresented());
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
| `connection-lost`, `unknown` | `reconnect` com backoff; esgotadas as tentativas, `clean-session` (`reconnect-limit`) |
| `server-error` | `reconnect` com atraso fixo (`serverErrorDelayMs`), sem gastar tentativa |
| `qr-timeout` | `reconnect` (novo QR); após `maxQrCount` QRs, `clean-session` (`qr-limit`) |
| `logged-out`, `auth-failed` | `clean-session` |
| `replaced` | `stop`: não reconectar. Duas conexões do mesmo número se derrubariam em laço ([ADR 0036](../../../docs/adr/0036-escopo-de-sessao.md)) |

`decide()` assume que a decisão será executada e avança o estado. Uma limpeza que viria antes
de `minCleanIntervalMs` da anterior é adiada (o `delayMs` cresce), evitando loop de limpeza.
Relógio (`now`) e estado inicial (`initialState`) são injetáveis; `policy.state` expõe os
contadores para log.
