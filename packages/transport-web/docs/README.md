# @zapforge/transport-web

Transport do ZapForge para o chatbot dentro de um sistema web próprio (ERP, gestão escolar). O
sistema emite um JWT para o widget, e o widget conversa com o bot por WebSocket. As decisões estão
no [ADR 0077](../../../docs/adr/0077-transport-web.md).

## Uso

```ts
import { createBot, createHttp } from '@zapforge/core';
import { web } from '@zapforge/transport-web';

const http = createHttp({ port: 3000 });

const bot = createBot({
  transport: web({
    auth: { secret: process.env.CHAT_JWT_SECRET },   // ou { jwksUrl: 'https://erp/.well-known/jwks.json' }
    tenantClaim: 'escola',                          // opcional: o claim vira chat.tenantId
    origins: ['https://erp.exemplo.com'],           // opcional
  }),
  http,
  prefix: '',          // no web, o comando pode vir sem prefixo
  plugins: [/* ... */],
});
await bot.start();
```

O transport exige `http` no `createBot`. Sem ele, o `createBot` lança `BotConfigError`. As rotas
ficam sob `/transports/web` na sessão `default`, ou sob `/sessions/<sessão>/transports/web` nas
outras ([HTTP do core](../../core/docs/http.md)):

| Rota | Para quê |
| --- | --- |
| `GET /chat` | WebSocket do chat |
| `POST /media` | Upload de um arquivo, com o token |
| `GET /media/:id` | Download da mídia que o bot enviou |
| `OPTIONS /media` | Preflight de CORS do upload |

### Opções

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `auth.secret` | — | Segredo do `HS256`, com pelo menos 32 bytes |
| `auth.jwksUrl` | — | JWKS do sistema do dono (`RS256` ou `ES256`), buscado e cacheado pelo `jose` |
| `auth.issuer` / `auth.audience` | não confere | `iss` e `aud` esperados |
| `tenantClaim` | sem tenant | Claim com o cliente do dono. Configurado, o token sem ele é recusado |
| `origins` | qualquer uma | Origens aceitas no WebSocket e no upload. Pedido sem `Origin` passa |
| `media.maxBytes` | 10 MiB | Teto de um upload |

## O token

O sistema do dono assina um JWT com `sub` (o ID do usuário no sistema) e `exp`. Os dois são
obrigatórios. Os outros claims vão inteiros para `message.sender.claims`, e o plugin os lê como
dados verificados:

```ts
command({
  name: 'notas',
  run: (c) => {
    const turma = c.message.sender.claims?.['turma'];
    // ...
  },
});
```

- **Contato:** `id` é o `sub` (com o tenant na frente, `<tenant>:<sub>`), `name` vem do claim `name`
  e `phone` é `null`.
- **Tenant:** com `tenantClaim`, o valor do claim vira `chat.tenantId`, e o `ctx.storage` dos
  plugins fica no escopo dele ([ADR 0072](../../../docs/adr/0072-isolamento-por-tenant.md)). O mesmo
  `sub` em dois tenants são duas pessoas.
- **Validade:** o token é validado uma vez por conexão. No `exp`, a conexão fecha com 4401, e o
  widget reconecta com um token novo. O que o bot enviar no meio-tempo espera no buffer.
- O transport não guarda o token.

Para cortar um usuário antes do `exp`, emita tokens curtos (minutos) e renove pelo sistema do dono.

## Conversas

O widget escolhe a conversa ao se autenticar (`conversation`, padrão `default`). Pode ser uma por
tela ou por registro, como `orcamento-42`. O `chat.id` é `<contato>/<conversa>`, então o usuário só
alcança as próprias. Cada conversa é um chat do kernel, com espera de resposta (`expectReply`),
botões e fila próprios. Várias abas na mesma conversa recebem as mesmas respostas.

O transport não guarda histórico. Se o widget mostra mensagens antigas, quem as guarda é o sistema
do dono ou um plugin.

### Cliente fora

O que o bot envia a uma conversa sem conexão aberta espera em memória, até 100 frames por conversa
e por 1 hora, e sai em ordem na próxima conexão. "Digitando" não espera. Um restart do processo
perde o buffer.

## Protocolo v1

Frames JSON de até 64 KiB. Os tipos estão exportados (`ClientFrame`, `ServerFrame`).

**Cliente → servidor**

```jsonc
{ "type": "auth", "token": "<jwt>", "conversation": "orcamento-42" } // primeiro frame, em até 10 s
{ "type": "message", "ref": "c1", "text": "oi", "attachments": ["<id do upload>"] }
{ "type": "action", "actionId": "<id do botão>" }
```

Espere o `ready` antes de mandar a primeira mensagem.

**Servidor → cliente**

```jsonc
{ "type": "ready", "chatId": "u1/orcamento-42", "userId": "u1" }
{ "type": "ack", "ref": "c1", "id": "<id da mensagem do usuário>" }
{ "type": "message", "id": "…", "timestamp": 1760000000000, "kind": "text", "text": "oi",
  "formatted": { "type": "formatted", "nodes": ["oi"] }, "quotedId": "…",
  "actions": [{ "id": "…", "label": "Notas" }] }
{ "type": "message", "id": "…", "kind": "image", "text": "legenda",
  "media": { "url": "/transports/web/media/<id>", "mimetype": "image/png" } }
{ "type": "edit", "id": "…", "text": "novo texto" }
{ "type": "delete", "id": "…" }
{ "type": "typing", "kind": "text" }
{ "type": "error", "code": "invalid-frame", "message": "…", "ref": "c1" }
```

- `formatted` é a árvore do [texto formatado](../../core/docs/text.md). Quem não a renderiza usa o
  `text`.
- `edit` permite mostrar uma resposta longa aos poucos: o plugin envia e depois edita.
- O clique num botão manda `action` com o `id` do botão. O kernel confere se o botão foi enviado a
  essa conversa.
- A mensagem do usuário não traz citação: o `quoted` chega `null` ao plugin.

**Fechamentos**

| Código | Quando |
| --- | --- |
| 4400 | Primeiro frame que não é um `auth` válido, ou frame antes do `ready` |
| 4401 | Token ausente, inválido ou vencido, `auth` que não chega em 10 s, ou `exp` atingido |
| 4403 | Token sem o claim de `tenantClaim` |
| 1009 | Frame acima de 64 KiB |
| 1001 | O bot parou ou o transport desconectou |

Frame inválido depois do `ready` recebe um `error` e a conexão segue.

## Mídia

O upload é um `POST <base>/media` com o arquivo cru no corpo:

```http
POST /transports/web/media?name=boletim.pdf
Authorization: Bearer <jwt>
Content-Type: application/pdf
```

A resposta é `201 { "id": "…" }`. O ID entra em `attachments` da próxima mensagem, uma vez, e só
para quem fez o upload. O `type` da mensagem vem do mimetype do primeiro anexo: `image/*`,
`video/*`, `audio/*`, e o resto vira `document`. Recusas: 401 (token), 403 (tenant ou origem), 413
(acima de `media.maxBytes`), 415 (sem `Content-Type`).

A mídia que o plugin envia em bytes sai como `media.url`, relativa à origem do servidor e válida
por 1 hora. A URL é a autorização, para o `<img src>` funcionar sem header. A mídia enviada por URL
(`{ url }`) vai como veio. O download responde com `Content-Security-Policy: sandbox` e
`nosniff`, e documento sai como anexo.

Uploads e mídia ficam em memória, até 256 MiB no total. Acima disso, sai o mais antigo.

## Capabilities

`send.text`, `send.image`, `send.video`, `send.audio`, `send.document`, `media.download`,
`actions`, `quoted`, `typing`, `message.edit` e `message.delete`. Sem limites de tamanho. O perfil
`web` do [kit de testes](../../testing/docs/README.md) declara as mesmas.

## CORS, origem e rate limit

Sem `origins`, qualquer origem conecta e faz upload, porque quem autoriza é o token, e o token não
vai em cookie. Com `origins`, as outras recebem 403, e o CORS do upload só responde a elas. Para
limitar mensagens por usuário, use o middleware `rateLimit` do kernel, que conta por `sender.id`.

## Cliente de referência

`@zapforge/transport-web/client` implementa o protocolo sobre o `WebSocket` e o `fetch` globais
(navegador e Node 24), sem o core nem o `jose`:

```ts
import { connectWebChat } from '@zapforge/transport-web/client';

const chat = await connectWebChat({
  url: 'wss://bot.exemplo.com/transports/web/chat',
  token: await buscarTokenNoErp(),
  conversation: 'orcamento-42',
});

chat.on('message', (m) => mostrar(m.text, m.actions, chat.mediaUrl(m)));
chat.on('typing', () => mostrarDigitando());
chat.on('close', ({ code }) => {
  if (code === 4401) reconectarComTokenNovo();
});

await chat.send('!notas');
const id = await chat.upload(arquivo, arquivo.type, arquivo.name);
await chat.send('segue o boletim', { attachments: [id] });
chat.click(acao.id);
```

`connectWebChat` rejeita se o servidor fechar antes do `ready`. Os frames que chegam antes do
primeiro `on()` do tipo (os do buffer, logo depois do `ready`) vão para ele.

## Fora do escopo por enquanto

Menções, reações, álbum, streaming próprio de texto parcial e modo visitante sem token. Cada um
entra numa minor, quando um sistema pedir.
