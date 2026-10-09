# ADR 0068 — Desconexão fatal e transport sem pareamento

**Status:** Aceito (2026-10-09) · Detalha **D03** ([ADR 0003](0003-transport-abstrato.md)),
**D13** ([escopo do core](../../ZAPFORGE_PLAN.md#4-decisões)), **D45**
([ADR 0045](0045-queda-de-rede-nao-limpa-sessao.md)) e **D48**
([ADR 0048](0048-connect-resolve-ao-iniciar.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O `DisconnectReason` e a `ReconnectionPolicy` vieram do WhatsApp (#280). A investigação no
código confirmou os três pontos da issue:

- **Não há motivo para erro de configuração.** Os motivos são `qr-timeout`, `logged-out`,
  `auth-failed`, `replaced`, `server-error`, `connection-lost` e `unknown`. Intents não
  permitidas no Discord (close codes 4013/4014) ou a porta ocupada do transport web teriam de
  virar `unknown` ou `server-error`, e o bot reconectaria para sempre, a cada 15 s ou 5 s.
- **Loop de `auth-failed`.** A política decide `clean-session` para `auth-failed`, e com
  transport por fábrica o `clearSession` padrão é `auth.clear()`. Num transport por token
  (Discord 4004, Telegram 401), o bot apaga uma sessão que não guarda nada útil, reconecta com o
  mesmo token e falha de novo. O `minCleanIntervalMs` só espaça o laço: uma limpeza a cada 60 s,
  para sempre, com um `warn` por volta. O bot fica `running` e nunca conecta. Um teste do bot com
  transport sem pareamento reproduziu o laço antes da correção.
- **Reconexão em dobro.** discord.js, grammY e telegraf reconectam sozinhos depois de uma queda
  de rede. O executor chama `connect()` a cada `closed`; um adapter que repassa os fechamentos
  internos abriria uma conexão por cima da que a lib já refaz. O `transport.md` não dizia nada.

O mesmo padrão nos caminhos vizinhos:

- `logged-out` também limpa a sessão, mas significa "encerrada no aparelho" e só existe onde há
  pareamento; um token revogado é `auth-failed`. `qr-limit` só vem de QRs apresentados. Nenhum
  dos dois entra em laço num transport por token.
- Um `connect()` de reconexão que rejeita conta como `connection-lost` (ADR 0048). Um transport
  que rejeitasse por erro de configuração cairia no backoff sem fim; por isso o erro de
  configuração precisa chegar como `closed` com motivo próprio.
- O 409 do Telegram tem duas origens. Outro `getUpdates` com o mesmo token é o caso do
  `replaced`: duas instâncias se derrubariam em laço, e parar é o certo (ADR 0036). Webhook ativo
  é configuração: `fatal`, ou o adapter apaga o webhook antes do polling.
- O Baileys não reconecta sozinho: cada fechamento do socket é terminal para ele, e o adapter já
  emite um `closed` por socket.

Sobre ampliar as uniões: `DisconnectReason` sai em `@zapforge/core` (plugins o leem no
`connection.status`), e `ReconnectionDecision` e a causa do `stop` saem em
`@zapforge/core/adapter`. Um `switch` exaustivo com `never` no `default` deixa de compilar quando
a união ganha membro; sem `default`, o membro novo passa reto em runtime. No repositório, o único
`switch` sobre o motivo é o da própria política, e nenhum sobre a causa do `stop` fora do
executor. É o mesmo problema que o #272 trata para `MessageType` e `OutgoingContent`.

Alternativas consideradas:

- **Campo `Transport.pairing?: boolean`, ausente = pareia.** Totalmente aditivo, mas o padrão
  seguro fica invertido: um adapter por token que esquece o campo volta ao laço, e o caso que a
  issue quer evitar continua o padrão. Também abre um lugar novo para declarar o que o transport
  suporta, além de `capabilities`.
- **`auth-failed` sempre para.** Mudaria o WhatsApp: credencial rejeitada (403, 411) hoje limpa e
  volta a parear sozinha, e o legacy depende disso.
- **`logged-out` e `qr-limit` também param sem pareamento.** Sem caso real (um transport sem
  pareamento não os emite) e mudaria o comportamento de transports de teste e de terceiros que
  os emitem sem declarar nada.
- **Motivo `rate-limited` com reconexão atrasada** (caminho 3 da issue). As libs tratam o 429 por
  conta própria, e o `server-error` já reconecta com atraso fixo. Fica para quando um adapter
  precisar.
- **`process.exit` ou `process.exitCode` no core.** Estado global e decisão do app (ADR 0004,
  `docs/bot.md` → Sinais do processo).
- **Evento novo `bot.stopped` com o motivo, ou `bot.stopReason`.** O `closed` com o motivo já chega
  aos listeners antes do `stop()`; um evento a mais repetiria a informação.

## Decisão

- **`DisconnectReason` ganha `'fatal'`**: erro de configuração que reconectar não resolve (token
  sem permissão, intents não permitidas, porta ocupada). A política decide
  `{ action: 'stop', cause: 'fatal' }`, sem mexer nos contadores, haja pareamento ou não. O erro
  nativo segue em `error`.
- **Capability `pairing`**: a sessão se pareia por QR ou código (`connection.qr`,
  `connection.pairing-code`), então limpar as credenciais leva a um pareamento novo. É a menor
  forma de o transport declarar: `capabilities` já é o conjunto fixo do que ele suporta, o
  `hasCapability` já existe, e um plugin que exibe QR pode citá-la em `requires`. Quem não a
  declara não tem pareamento, e esse é o lado seguro: parar em vez de limpar.
- **`auth-failed` sem `pairing` decide `{ action: 'stop', cause: 'auth-failed' }`.** Com
  `pairing`, segue em `clean-session`, como hoje. `logged-out` e `qr-limit` não mudam.
- **A política recebe `pairing` por opção** (`ReconnectionPolicyOptions.pairing`, padrão `true`,
  o comportamento do legacy para quem usa a política sem o bot). O `Bot` a preenche com
  `hasCapability(transport, 'pairing')`; `BotReconnectionOptions` não a aceita, porque quem sabe
  é o transport, não a config.
- **Como o `stop` aparece para quem opera.** `fatal` e `auth-failed` sem pareamento logam em
  `fatal`, com `reason`, `cause`, o erro nativo em `err` e os contadores da política: o bot não
  volta sozinho, alguém precisa corrigir a config. `replaced` segue em `error`, porque a outra
  conexão continua de pé. O `closed` chega aos listeners de `connection.status` antes do
  `stop()`, e o bot termina em `stopped`, com os ganchos do `onStop()`. O core não encerra o
  processo nem escolhe o código de saída: o app olha o motivo num listener (exemplo em
  `docs/bot.md`). Nenhum timer de reconexão sobra depois do `stop()`.
- **Lib que se reconecta sozinha.** O adapter sobre ela só emite `closed` quando a queda é
  terminal: a lib desistiu, ou o erro é dos que ela não tenta de novo. Os fechamentos internos
  ficam no adapter (no máximo `connecting` e `open`, para log e listeners).
- **Mapeamento das plataformas** (orientação no `transport.md`, aplicada por cada adapter):
  Discord 4004 → `auth-failed`, 4013/4014 → `fatal`; Telegram 401 → `auth-failed`, 409 por outro
  `getUpdates` → `replaced`, 409 por webhook → `fatal`; web com a porta indisponível → `fatal`.
- **Uniões ampliadas antes do 1.0.** O membro `fatal` e as causas `fatal` e `auth-failed` do
  `stop` entram agora, em 0.x, registrados no changeset. A regra para as próximas adições
  (`default` obrigatório, união aberta ou lote único) é do #272, que deve contar o
  `DisconnectReason` e a `ReconnectionDecision` na lista.

## Consequências

- Token inválido ou intents erradas param o bot na primeira queda, com uma linha em `fatal`, em
  vez de um laço de limpeza com `warn` a cada minuto.
- O Baileys declara `pairing` e mantém o comportamento: credencial rejeitada limpa a sessão e
  volta a parear.
- Um transport de terceiros que emite `auth-failed` e pareia por QR precisa declarar `pairing`,
  ou passa a parar em vez de limpar. O `FakeTransport` do kit declara todas as capabilities por
  padrão, então segue limpando.
- `CAPABILITIES` ganha `pairing`. Um `switch` exaustivo sobre o `DisconnectReason` ou sobre a
  causa do `stop` deixa de compilar até tratar `fatal` (e `auth-failed`, na causa).
- A fila de saída só pausa no `closed`: durante a reconexão interna de uma lib, um envio que
  falha gasta o retry da fila. Fica como limite conhecido do contrato; tratá-lo é da fila
  de saída.
- O caminho quente não muda: a decisão só roda nas transições de conexão.
