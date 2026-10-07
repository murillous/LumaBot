# @zapforge/transport-baileys — documentação

Transport do WhatsApp sobre o [Baileys](https://github.com/WhiskeySockets/Baileys). Implementa o
contrato `Transport` do core ([Transport](../../core/docs/transport.md)). O porquê das decisões
está nos [ADRs](../../../docs/adr/README.md).

> Em construção (M2-1). Por enquanto o pacote conecta, pareia, informa as quedas e entrega as
> mensagens recebidas. Envio, capabilities e eventos de grupo, contato, reação e edição chegam nas
> próximas sub-issues; até lá `capabilities` vem vazio e toda ação lança `UnsupportedError`.

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
  apagamento, voto de enquete). Edição, reação e apagamento viram eventos próprios no M2-1.6.

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

## Credenciais

Ficam no `AuthStateStore` da sessão (`storage.authState(session)`), no lugar do
`useMultiFileAuthState`: sem pasta de sessão. Credenciais e chaves passam para JSON pelo
`BufferJSON` do Baileys. Cada `creds.update` grava as credenciais, em ordem; uma falha na gravação
vai para o log em `error`.

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
