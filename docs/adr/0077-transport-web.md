# ADR 0077 — `@zapforge/transport-web`: chat por WebSocket com JWT, conversa por usuário e mídia por HTTP

**Status:** Aceito (2026-10-10) · Detalha **D55** ([ADR 0055](0055-plataformas-alvo-e-transport-web.md))
sobre o HTTP do core (**D76**, [ADR 0076](0076-http-do-core.md)) · Confirma a coluna web da matriz
de capabilities (**D70**) e o perfil `web` do kit (**D73**)

## Contexto

O D55 pôs um transport fora do WhatsApp antes do 1.0: o chatbot dentro dos sistemas do dono (ERP,
gestão escolar), que valida o contrato neutro (#287). O contrato já tem o que ele precisa: claims
verificados no `Contact` (D57), `Chat.tenantId` (D72), ações (D62), conversa guiada (D60), prefixo
vazio (D63) e as rotas de transport no HTTP do core (D76). Faltava decidir o protocolo.

A investigação, sobre as perguntas da issue:

- **O que é o `Chat.id`.** Uma aba some no reload, e com ela a conversa guiada e o que foi enviado
  com o cliente fora. Por usuário, o mesmo usuário não tem dois assuntos abertos. O sistema do dono
  pode querer uma conversa por tela ou por registro (um orçamento do ERP, por exemplo).
- **Histórico.** O transport não guarda conversa: o sistema do dono já guarda o que precisa, e a
  persistência é de plugin (storage). O transport só segura o que foi enviado com o cliente fora.
- **Streaming e digitação.** Texto parcial é editar a mesma mensagem (`message.edit`), que o web
  declara. Um protocolo de streaming próprio fica para quando a Luma precisar. "Digitando" é a
  capability `typing`.
- **CORS, origem e rate limit.** O WebSocket não passa por CORS, mas o navegador manda `Origin`. A
  autenticação é por token, não por cookie, então outro site não age em nome do usuário sem o
  token; a lista de origens fecha o resto. O rate limit por usuário já é o middleware `rateLimit`
  do kernel, por `sender.id`.
- **Quando validar o JWT.** O navegador não manda `Authorization` no upgrade do WebSocket. Na query
  string, o token cai em log de proxy. Validar por mensagem custa uma verificação de assinatura por
  frame.
- **Mídia.** Bytes em base64 no frame do WebSocket inflam um terço e prendem o socket; um upload
  grande atrasa o texto da mesma conversa.

Alternativas consideradas:

- **`Chat.id` por usuário ou por aba.** Por usuário, não há dois assuntos. Por aba, o reload perde
  a conversa.
- **Token na query string**, recusado com 401 antes do handshake: mais simples, mas o token fica em
  log. **Renovação no meio da conexão** (um `auth` novo estende o prazo): mais protocolo, e a
  reconexão com o buffer já cobre a troca de token.
- **Mídia em base64 no frame**, ou **só texto** na primeira versão: a primeira infla e prende o
  socket; a segunda tira do perfil `web` o que ele já promete.
- **Biblioteca de JWT própria** sobre o `node:crypto`: o JWKS (busca, cache, rotação de chave) e a
  lista de algoritmos são onde mora o erro de segurança. O `jose` faz isso sem dependências.
- **Modo visitante anônimo**: nenhum dos dois sistemas do dono precisa agora; entra por opção nova,
  sem quebrar nada.

## Decisão

- **Pacote `@zapforge/transport-web`**, público (D55), com a fábrica `web(options)` (D37). Exige
  `http` no `createBot`: sem `deps.http`, a fábrica lança e o `createBot` recusa com
  `BotConfigError`. Rotas sob o `basePath` do transport (D76): `GET /chat` (WebSocket),
  `POST /media`, `GET /media/:id` e `OPTIONS /media`.
- **Autenticação: JWT no primeiro frame.** O cliente abre o WebSocket e manda
  `{ type: 'auth', token, conversation? }` em até 10 s. O transport valida uma vez por conexão,
  com o `jose`: segredo compartilhado (`HS256`, pelo menos 32 bytes) ou JWKS (`RS256`/`ES256`),
  com `issuer` e `audience` opcionais e `exp` e `sub` obrigatórios. Token inválido, vencido ou que
  não chega fecha a conexão com **4401**; primeiro frame que não é um `auth` válido, com **4400**. No `exp`, o transport fecha com 4401, e o cliente reconecta com um token
  novo. O token não é guardado: a conexão guarda o contato e o prazo.
- **Identidade.** O `Contact` tem `id` do `sub`, `name` do claim `name` (se for texto),
  `phone: null` e `claims` com o payload verificado inteiro (D57). Com `tenantClaim`, o claim vira
  `chat.tenantId` (D72). Claim ausente ou vazio fecha com **4403**. O transport compõe o tenant no ID
  (`<tenant>:<sub>`, cada parte com `encodeURIComponent`).
- **`Chat.id` por conversa.** O cliente escolhe a conversa no `auth` (`conversation`, até 64
  caracteres `[A-Za-z0-9_-]`, padrão `default`). O ID é `<contato>/<conversa>`, então um usuário
  só alcança as próprias conversas. `kind: 'dm'`. Várias abas na mesma conversa recebem as mesmas
  respostas.
- **Envio para cliente fora.** Sem conexão aberta na conversa, o frame espera num buffer em
  memória, até 100 por conversa (cai o mais antigo) e por 1 h. Ele sai em ordem no próximo `auth`
  da conversa. "Digitando" não espera. A validade é conferida quando o buffer anda, sem timer.
- **Mídia por HTTP.** O upload é `POST /media`, com `Authorization: Bearer <jwt>`, o corpo cru e o
  mimetype no `Content-Type`, com até `media.maxBytes` (padrão 10 MiB). Ele responde
  `{ id }`, que o cliente cita na mensagem (`attachments: [id]`). O upload só serve ao contato que o
  fez. A mídia enviada pelo bot vira `GET /media/:id`, com um ID aleatório de 128 bits que vale
  1 h: a URL é a autorização, para o `<img src>` funcionar sem header. Mídia que o plugin envia
  por URL vai como veio. Os arquivos ficam em memória, com teto total de 256 MiB (sai o mais
  antigo).
- **Capabilities:** `send.text`, `send.image`, `send.video`, `send.audio`, `send.document`,
  `media.download`, `actions`, `quoted`, `typing`, `message.edit` e `message.delete`. Ficam de fora
  `mentions`, `reactions` e `send.album`: nenhum dos dois sistemas pede, e entram numa minor.
  `polls`, `groups*`, `send.voice`, `send.sticker` e `pairing` não se aplicam.
- **Conexão.** `connect()` emite `open`: a porta já abriu (D76). `disconnect()` fecha as conexões
  com 1001 e recusa novas (503) até o próximo `connect()`. Cliente que cai não afeta o bot.
- **Protocolo v1** em JSON, descrito na doc do pacote. Frames acima de 64 KiB fecham com 1009, e
  frame inválido depois do `auth` recebe `{ type: 'error' }` sem fechar. A citação na entrada não
  existe: o transport não guarda mensagens, então `quoted` chega `null`.
- **Origem:** com `origins`, o upgrade e o upload de outra origem recebem 403, e o CORS do upload
  só responde a elas. Sem `origins`, qualquer origem passa: quem autoriza é o token.
- **Cliente de referência** em `@zapforge/transport-web/client`: `connectWebChat()` sobre o
  `WebSocket` e o `fetch` globais (navegador e Node 24). Ele cobre o protocolo e serve aos testes
  de ponta a ponta.

## Consequências

- Nada muda no core. O perfil `web` do kit ganha `send.video`, `send.audio`, `quoted`,
  `message.edit` e `message.delete`, e um teste no pacote confere o perfil contra o transport, como
  no Baileys (D73). O teste do kit que usava o `web` como perfil sem `quoted` passa a usar
  capabilities explícitas, com o dono de acordo.
- O `jose` vira dependência do `transport-web`. O JWKS é buscado e cacheado por ele.
- A mídia e o buffer ficam em memória: um processo que reinicia perde o que estava esperando. O
  sistema do dono, que tem o histórico, recompõe a tela.
- A URL da mídia enviada é a autorização. Se ela vazar, vale até expirar (1 h).
- Uma conexão fica autenticada até o `exp`, mesmo que o sistema do dono revogue o usuário antes.
  Quem precisa cortar antes emite token curto.
- O 1.0 (#155) tem o segundo transport. O plugin portátil roda igual no Baileys e no web, com o
  menu de botões virando texto numerado no Baileys (D62).
