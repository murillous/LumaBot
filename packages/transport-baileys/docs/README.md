# @zapforge/transport-baileys — documentação

Transport do WhatsApp sobre o [Baileys](https://github.com/WhiskeySockets/Baileys). Implementa o
contrato `Transport` do core ([Transport](../../core/docs/transport.md)). O porquê das decisões
está nos [ADRs](../../../docs/adr/README.md).

> Em construção (M2-1). O pacote conecta, pareia, informa as quedas, entrega as mensagens
> recebidas e os eventos de reação, edição, apagamento, grupo e contato, envia e age sobre
> mensagens e grupos.

## Uso

```ts
import { createBot, definePlugin } from '@zapforge/core';
import { baileys } from '@zapforge/transport-baileys';

// Quem exibe o QR é um plugin: o evento chega pelo barramento.
const telaDePareamento = definePlugin({
  name: 'tela-de-pareamento',
  version: '1.0.0',
  engine: '>=0.0.0',
  setup: (ctx) => {
    ctx.events.on('connection.qr', ({ payload }) => mostrarQr(payload.qr));
  },
});

const bot = createBot({
  transport: baileys(), // pareia por QR
  storage, // as credenciais ficam aqui (auth state da sessão)
  plugins: [telaDePareamento],
});
await bot.start();
```

`baileys()` devolve uma fábrica ([ADR 0037](../../../docs/adr/0037-transport-por-fabrica.md)): o
bot entrega a ela o auth state da sessão e o logger. Nada abre antes do `bot.start()`.

## Opções

| Opção | Padrão | Efeito |
| --- | --- | --- |
| `pairing` | `'qr'` | `'qr'` emite `connection.qr`; `{ phone: '5511999999999' }` pede um código de pareamento para o número e emite `connection.pairing-code` |
| `version` | a mais recente | Versão do WhatsApp Web a anunciar (`[2, 3000, 1023223821]`). Sem ela, o transport busca a mais recente na primeira conexão; se a busca falhar, loga em `warn` e usa a que vem com o Baileys |

`pairing.phone` aceita só dígitos, com DDI (8 a 15). Um valor inválido faz o `createBot` lançar
`BotConfigError`.

## Pareamento

Só acontece quando a sessão não tem credenciais (primeiro uso ou depois de um logout).

- **QR**: cada QR gerado vira `connection.qr`. O Baileys gira o QR (o primeiro vale 60 s, os
  seguintes 20 s) até esgotar e fechar a tentativa.
- **Código**: no primeiro QR da tentativa, o transport pede o código para `pairing.phone` e emite
  `connection.pairing-code` (`{ code }`, 8 caracteres). O usuário digita o código no aparelho em
  *Aparelhos conectados → Conectar com número de telefone*. Um código por tentativa; quando ela
  expira, o bot reconecta e vem um código novo ([ADR 0050](../../../docs/adr/0050-codigo-de-pareamento.md)).

Os dois contam para o `maxQrCount` da reconexão do bot. Logo depois do pareamento o servidor fecha
a conexão pedindo restart (515); o bot reconecta sozinho, já com as credenciais novas.

```ts
createBot({ transport: baileys({ pairing: { phone: '5511999999999' } }), storage, plugins });

// No setup do plugin que exibe o pareamento:
ctx.events.on('connection.pairing-code', ({ payload }) => mostrarCodigo(payload.code));
```

## Mensagens recebidas

Cada mensagem nova do Baileys (`messages.upsert` do tipo `notify`) vira o evento `message` com a
`Message` do core ([Modelo de mensagem](../../core/docs/message.md)). Ficam de fora:

- `append`: histórico e cópias de sincronização, que não são mensagens novas;
- status (`status@broadcast`), que não é conversa;
- mensagens sem conteúdo (aviso de grupo, falha ao decifrar) ou só de controle (edição, reação,
  apagamento, voto de enquete). Edição, reação e apagamento viram eventos próprios
  ([Eventos](#eventos)).

As mensagens saem na ordem em que chegaram, mesmo quando resolver o telefone de uma demora. Se a
normalização de uma falhar, ela é descartada com log em `error` e as seguintes seguem.

### Envelopes

`ephemeralMessage`, `viewOnceMessage` (V1, V2 e V2Extension) e `documentWithCaptionMessage` são
desembrulhados, aninhados em qualquer ordem. `isViewOnce` fica `true` quando havia um envelope de
visualização única ou a mídia traz a flag `viewOnce`.

### Tipos

| Conteúdo do Baileys | `type` |
| --- | --- |
| `conversation`, `extendedTextMessage` | `text` |
| `imageMessage` | `image` |
| `videoMessage`, `ptvMessage` (vídeo redondo) | `video` |
| `audioMessage` com `ptt` | `voice` |
| `audioMessage` sem `ptt` | `audio` |
| `stickerMessage` | `sticker` |
| `documentMessage` (com ou sem legenda) | `document` |
| `locationMessage`, `liveLocationMessage` | `location` |
| `contactMessage`, `contactsArrayMessage` | `contact` |
| `pollCreationMessage` (V1 a V5) | `poll` |
| qualquer outro | `unknown` |

`text` é o texto ou a legenda. A mídia não é baixada na chegada: `media.download()` e
`media.stream()` chamam o `downloadMediaMessage` do Baileys, que pede ao aparelho o reenvio quando
o link expirou.

### Contatos e telefone

`sender.id` e os ids de `mentions` são o JID nativo sem o aparelho, de telefone
(`…@s.whatsapp.net`) ou LID (`…@lid`), como o WhatsApp mandou. `phone` é preenchido assim
([ADR 0046](../../../docs/adr/0046-ids-de-contato-e-metadata-de-grupo.md)):

1. JID de telefone: o número do próprio id;
2. LID com o JID alternativo que o Baileys manda junto (`participantAlt`, `remoteJidAlt`): o
   número dele;
3. LID sem alternativo: o mapeamento LID ↔ telefone que o Baileys guarda na sessão;
4. sem par conhecido (ou se a consulta falhar, com log em `warn`): `null`. Os papéis `owner` e
   `group-admin` falham fechados nesse caso.

`sender.name` é o `pushName`; menções e o autor da citada vêm com `name: null`. Na conversa
privada, o remetente de uma mensagem da própria sessão é a sessão.

### Citada

`quoted` é uma `Message` montada do `contextInfo`, com as mesmas regras (envelopes, tipos,
telefone). O proto da citada não traz horário nem nome do autor: `timestamp` é o da mensagem que
cita e `sender.name` é `null`. `fromMe` vale quando o autor é a sessão (por telefone ou LID).

## Eventos

Além de `message` e `connection.*`, o transport converte estes eventos do Baileys:

| Evento do Baileys | Evento do core |
| --- | --- |
| `messages.reaction` | `reaction` (`emoji: null` quando a reação foi removida) |
| `messages.update` com `editedMessage` | `message.edited`: a `Message` com o conteúdo novo e `isEdited: true` |
| `messages.update` com `REVOKE` | `message.deleted` (`deletedBy`: quem apagou, o autor ou um admin do grupo) |
| `group-participants.update` | `group.participants`; a própria sessão adicionada ou removida vira `group.joined`/`group.left` |
| `groups.upsert` (grupo criado com a sessão dentro) | `group.joined` |
| `groups.update` | `group.updated`, só com os campos alterados (`subject`, `description`, `announce`, `restrict`) |
| remetente de uma mensagem nova | `contact.updated` |

Todos passam pela mesma fila das mensagens, na ordem de chegada: a edição ou a reação nunca sai
antes da mensagem a que se refere. Uma conversão que falha é descartada com log em `error`, e as
seguintes seguem. Os eventos do socket anterior deixam de valer depois de uma reconexão.

- **Contatos e telefone**: `sender`, `deletedBy`, `actor` e os participantes seguem as regras de
  [Contatos e telefone](#contatos-e-telefone). O Baileys não manda o `pushName` nesses eventos;
  o nome vem do último que o contato usou numa mensagem, ou `null` se ele ainda não mandou
  nenhuma.
- **Edição**: o WhatsApp manda só o conteúdo novo; a citada e as menções vêm dele. O `timestamp`
  é o da edição.
- **Participantes**: `action` é `add`, `remove`, `promote` ou `demote`. Quem saiu sozinho chega
  como `remove`, com ele mesmo em `actor`. A troca de número (`modify`) não tem evento. Quando a
  própria sessão é adicionada ou removida, ela sai da lista e vira `group.joined`/`group.left`;
  promovida ou rebaixada, segue em `group.participants`.
- **Alteração de grupo**: ao sincronizar, o Baileys emite `groups.update` com os metadados
  completos de cada grupo. Esse não é uma alteração e não vira `group.updated`; o cache de
  metadados cai mesmo assim. Descrição removida chega como `description: null`.
- **Status** (`status@broadcast`) fica de fora em todos, como nas mensagens.

### `contact.updated`

Sai antes da `message` do remetente, para quem guarda nomes já tê-lo ao tratar a mensagem:

- na **primeira vez** que o contato manda uma mensagem desde que o processo subiu, com o `name`
  (`pushName`) e o `phone` que houver;
- depois, só quando o nome ou o telefone muda, com só o campo alterado.

Campo desconhecido não conta como mudança: uma mensagem sem `pushName` não apaga o nome visto, e um
LID sem telefone resolvido não apaga o telefone. Mensagens da própria sessão não geram o evento. Os
contatos vistos ficam em memória durante a vida do transport (sobrevivem às reconexões); ao
reiniciar o processo, cada um sai de novo na primeira mensagem. Quem precisa do nome de todo
remetente (o `trackUsers` do legacy) faz upsert a cada `contact.updated`.

### O que chegou com o bot desconectado

Ao reconectar, o servidor entrega o que chegou enquanto o bot estava fora. As mensagens vêm como
`append` e ficam de fora, mas o Baileys emite os eventos de reação, edição, apagamento e grupo
delas sem dizer que são atrasados, então esses saem. Os de grupo atualizam o estado (quem entrou,
o assunto novo); quem reage a `reaction` ou `message.edited` pode querer descartar os antigos pelo
horário da mensagem. Nessa sincronização o Baileys também junta eventos: uma reação ou edição de
uma mensagem que chegou no mesmo lote pode vir incorporada a ela, sem evento próprio.

## Capabilities

O transport declara todas as capabilities do core (plano §6.10): `groups`, `groups.admin`,
`mentions`, `reactions`, `presence`, `send.text`, `send.image`, `send.video`, `send.audio`,
`send.voice`, `send.sticker`, `send.document`, `media.download`, `message.edit`,
`message.delete`, `polls` e `quoted`. Todo plugin que declara `requires` com elas carrega.

## Envio e ações

O kernel chama o transport pela fila de saída (`ctx.reply`, `ctx.send`, `ctx.groups`); o plugin
não fala com ele direto. Sem conexão aberta, toda ação falha na hora com `baileys: sem conexão`,
mas a fila do bot já pausa nas quedas, então isso só aparece se alguém chamar o transport por
fora.

| Conteúdo do core | No Baileys |
| --- | --- |
| `text` | `{ text }` |
| `image`, `video` | `{ image }`/`{ video }`, com `caption` e `mimetype` |
| `audio` | `{ audio, ptt: false }` |
| `voice` | `{ audio, ptt: true }`; sem `mimetype`, o Baileys usa `audio/ogg; codecs=opus` |
| `sticker` | `{ sticker }` |
| `document` | `{ document, fileName, mimetype, caption }` |
| `poll` | `{ poll: { name, values, selectableCount } }`, com `selectableCount` padrão 1 |

A mídia vai como `Buffer` ou `{ url }`, que o Baileys baixa. `mentions` entra em qualquer tipo.

- **Citação**: citar uma mensagem recebida por este transport (o `ctx.reply` cita por padrão)
  manda ao Baileys o proto original, então a citada aparece com mídia e legenda. Uma `Message`
  montada fora dele (testes, storage) vai só com a chave e o texto.
- **Chave**: `send` devolve a `MessageKey` da mensagem criada (`fromMe: true`; em grupo,
  `senderId` é a sessão), pronta para `react`, `edit` e `delete`.
- **Reação**: `react(key, null)` remove a reação (texto vazio para o WhatsApp).
- **Edição e apagamento**: `edit` troca o texto (ou a legenda) de uma mensagem da sessão; `delete`
  apaga para todos, de uma mensagem da sessão ou, em grupo onde o bot é admin, de qualquer um.
- **Presença**: `sendPresence(chatId, 'composing' | 'recording' | 'paused' | 'available' |
  'unavailable')`.

## Grupos

`getGroupMetadata` traz assunto, descrição, dono e participantes com `isAdmin`/`isSuperAdmin` e o
`phone` resolvido como nas mensagens (o `phoneNumber` que o WhatsApp manda junto com um LID ou o
mapeamento da sessão). É o que o kernel consulta no `role: 'group-admin'`.

Os metadados ficam em cache por grupo, porque o kernel os pede a cada comando de admin
([ADR 0046](../../../docs/adr/0046-ids-de-contato-e-metadata-de-grupo.md)). O cache cai:

- nos eventos `groups.update` e `group-participants.update` do Baileys;
- depois de `updateGroupParticipants`, sem esperar o evento;
- a cada conexão, porque a queda pode ter perdido algum evento.

Consultas simultâneas ao mesmo grupo viram uma só, e uma consulta que falhou não fica no cache. O
envio em grupo reaproveita o cache (`cachedGroupMetadata` do Baileys) sem disparar consulta.

`updateGroupParticipants` (`add`, `remove`, `promote`, `demote`) exige que o bot seja admin. O
WhatsApp responde por participante; se algum não sair com 200, a chamada lança com o id e o
status de cada um que falhou (ex.: `remove recusado para 5511…@s.whatsapp.net (403)`), mesmo que
os outros tenham passado.

## Credenciais

Ficam no `AuthStateStore` da sessão (`storage.authState(session)`), no lugar do
`useMultiFileAuthState`: sem pasta de sessão. Credenciais e chaves passam para JSON pelo
`BufferJSON` do Baileys. Cada `creds.update` grava as credenciais, em ordem; uma falha na gravação
vai para o log em `error`.

As chaves de criptografia passam por um cache em memória (o `makeCacheableSignalKeyStore` do
Baileys, 5 minutos por chave): o Signal lê a sessão do remetente a cada mensagem, e o cache poupa
essas leituras do storage. Toda gravação vai ao storage na hora. O cache é de cada tentativa de
conexão: depois que o bot limpa a sessão, a próxima tentativa começa sem ele. Ele não vê o que
outro processo grava na mesma sessão, o que o bot já impede ([ADR 0036](../../../docs/adr/0036-escopo-de-sessao.md)).

O transport nunca apaga credenciais: quem limpa a sessão é o bot, na decisão `clean-session` da
política de reconexão.

## Quedas

O transport não reconecta: emite `connection.status` `closed` com o motivo, e o bot decide
([Bot → Reconexão](../../core/docs/bot.md#reconexão)). O código do Baileys vira motivo assim:

| Código do Baileys | Motivo | O bot |
| --- | --- | --- |
| 401 `loggedOut` | `logged-out` | limpa a sessão e pareia de novo |
| 403 `forbidden`, 411 `multideviceMismatch` | `auth-failed` | limpa a sessão e pareia de novo |
| 440 `connectionReplaced` | `replaced` | para, sem reconectar |
| 408 com QR/código na tela | `qr-timeout` | novo QR/código, até o limite |
| 408 sem pareamento, 428 `connectionClosed`, 515 `restartRequired` | `connection-lost` | reconecta com backoff |
| 500 `badSession`, 503 `unavailableService`, 405 | `server-error` | reconecta com atraso fixo |
| outro, ou erro sem código | `unknown` | reconecta com backoff |

O 500 não apaga a sessão: o Baileys o usa também para todo stream error sem motivo conhecido, e
uma queda qualquer não pode custar o pareamento
([ADR 0045](../../../docs/adr/0045-queda-de-rede-nao-limpa-sessao.md)). Pelo mesmo motivo o 405,
que o servidor manda quando recusa a versão do cliente, é `server-error`.

## `self` e `native`

- `transport.self` é preenchido no `open`: `id` sem o aparelho (`5511999999999@s.whatsapp.net`),
  `name` e `phone` (do próprio id ou, se ele vier como LID, do `phoneNumber`).
- `transport.native` é o `WASocket` da tentativa atual (`null` sem conexão), para o escape hatch
  `ctx.unsafe.native`. A cada reconexão o socket é outro: não guarde a referência.

## Logs

As linhas do Baileys passam pelo logger do bot com `{ lib: 'baileys' }`, no mesmo nível e com a
mesma censura de segredos.
