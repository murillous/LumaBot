# ADR 0067 — Janela da plataforma no retry e ritmo padrão do transport

**Status:** Aceito (2026-10-09) · Detalha **D19** ([ADR 0019](0019-fila-de-saida-anti-ban.md)),
**D39** ([ADR 0039](0039-fila-de-saida-e-conexao.md)) e **D47**
([ADR 0047](0047-espera-na-fila-de-saida-fora-do-prazo.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

A fila de saída re-tentava às cegas (#281). A investigação no código confirmou os três pontos da
issue:

- **O retry ignora a espera que a plataforma informa.** O `#handleFailure` agenda a re-tentativa
  com o backoff (1 s, depois 2 s, com jitter, teto de 30 s) e desiste na terceira tentativa, cerca
  de 3 s depois da primeira. O 429 do Discord traz `retry_after`, por rota ou global, e o do
  Telegram traz `parameters.retry_after`, que passa de dezenas de segundos. A fila tentava antes
  de a janela abrir, tomava outra recusa e desistia. Num 429 global, os outros chats continuavam
  enviando para uma plataforma que recusaria tudo.
- **O erro permanente é repetido.** O `isTransient` só não re-tenta `UnsupportedError` e erros com
  `retryable: false`. Um adapter que não marca a falha segura o chat por três tentativas
  (mensagem longa demais, bot bloqueado, sem permissão, arquivo grande demais). A convenção existia,
  mas nenhum documento dizia o que marcar.
- **O ritmo é do WhatsApp.** `globalIntervalMs: 300` e `chatIntervalMs: 1000` são a política
  anti-ban do WhatsApp (D19). O Telegram permite ~30 mensagens/s no total, ~1/s por chat privado
  e 20/min por grupo. O discord.js já limita a taxa por rota, e o intervalo do kernel só soma
  latência. Hoje só a config do bot muda o ritmo, e cada app teria de saber o da plataforma.

Caminhos vizinhos: a reconexão tem backoff próprio, mas é da conexão e não de envio. As ações
(reação, edição, participantes; ADR 0040) passam pelo mesmo `#handleFailure` e ganham a correção
junto. O adapter do Baileys não marca nenhum erro com `retryable: false`: fica para o adapter, fora
deste escopo.

Perguntas da issue:

- **A espera longa conta no prazo do envio?** O `sendTimeoutMs` (ADR 0039) mede só a chamada ao
  transport, e a espera é antes da próxima chamada. O prazo do comando ou listener pausa enquanto
  o `reply` não assenta (ADR 0047), o que cobre a espera. O que limita a espera é o teto que a
  fila já tem para o retry, `retry.maxDelayMs`.
- **Humanização.** A re-tentativa volta a mostrar presença antes do envio, como já fazia. Uma
  falha de presença na janela vai para `onPresenceError`, e o envio segue.
- **Resposta a interações (#277).** A confirmação da interação é do transport e acontece antes do
  `interaction` (ADR 0064). A resposta que sai pela fila é um envio comum.

Alternativas consideradas:

- **Classe de erro do core (`RateLimitError`).** O adapter teria de embrulhar o erro nativo, e o
  log perderia o tipo dele. O `retryable: false` já é duck typing, e a janela segue o mesmo
  caminho.
- **O core ler `retry_after` ou o status HTTP.** Poria formato de plataforma no core, e os 4xx
  não querem dizer a mesma coisa em todo lugar (o 400 do Telegram cobre tanto texto longo quanto
  chat inexistente).
- **Esperar qualquer janela, sem teto.** Uma janela de minutos manda a resposta fora de contexto,
  e a mensagem fica ocupando o chat.
- **A janela longa pausar a fila com o `maxPauseMs`.** Mistura taxa com conexão caída: o
  `'disconnected'` rejeitaria envios de chats que a plataforma aceita.
- **A janela global só para o envio que re-tenta.** Os outros chats continuariam batendo numa
  plataforma que já disse não, e o Discord bloqueia o IP depois de muitas requisições recusadas.
- **`chatIntervalMs` como função do `Chat` (privado ou grupo).** A fila só conhece o `chatId`, e o
  mapa de cooldowns depende de o intervalo ser fixo para limpar em O(1). O limite do grupo do
  Telegram chega como 429 com janela, que esta decisão já respeita.
- **O transport sobrescrever a config do bot.** O app perderia o controle do ritmo, inclusive o
  zero dos testes.

## Decisão

- **`retryAfterMs` no erro do transport.** Número finito ≥ 0, em ms. A fila re-tenta depois desse
  tempo exato, sem jitter, no lugar do backoff. O transport converte o formato da plataforma; o
  core não conhece `retry_after`. Um valor inválido é ignorado, e vale o backoff.
- **`retryAfterScope: 'global'`.** A janela vale para todos os chats: nenhum chat despacha antes
  de ela abrir, mesmo que o envio que falhou não re-tente. Sem o campo, ou com `'chat'`, só o
  chat do envio espera. Os envios em andamento terminam.
- **A janela não muda o que é re-tentável.** Ela conta em `maxAttempts`, e `retryable: false` e o
  `retry.isRetryable` continuam decidindo. O que muda é quanto esperar.
- **Teto: `retry.maxDelayMs`.** Uma janela acima dele (padrão 30 s) não re-tenta, e o envio
  rejeita com o erro do transport. A janela global vale mesmo assim, porque enviar antes dela só
  geraria outra recusa. Ela não conta no `sendTimeoutMs` nem no prazo do handler (ADR 0047); o
  `close({ drain: false })` descarta o que espera e cancela os timers.
- **Mapeamento documentado** em `docs/transport.md`: 400, 401, 403, 404 e 413 viram
  `retryable: false`; 429 vira `retryAfterMs`; 5xx e falhas de rede ficam transitórias.
- **`Transport.pacing`**, opcional (`TransportPacing`: `globalIntervalMs`, `chatIntervalMs`), lido
  uma vez na construção da fila. A ordem é a config do bot, depois o `pacing`, depois o padrão do
  core, campo a campo. O padrão do core continua 300 ms e 1000 ms: um transport que não declara
  nada segue com a política conservadora.

## Consequências

- Mudança aditiva: `Transport.pacing` e os dois campos do erro são opcionais, e o transport que
  não os usa segue igual. `TransportPacing` entra nos tipos públicos.
- Um 429 com janela dentro do teto não perde a resposta: ela sai quando a janela abre.
- Uma janela global longa segura todos os chats até abrir. O backlog continua limitado pelo
  `maxPending`, e o que chega espera.
- Os erros permanentes continuam dependendo do adapter: sem `retryable: false`, são repetidos. O
  Baileys ainda não marca os dele.
- O `ctx.send` do plugin e os jobs continuam contando a espera no próprio prazo (ADR 0047). Uma
  janela de 20 s num `await ctx.send` pode estourar o `commandMs` ou o `jobMs`.
- O caminho quente não muda: o erro só é lido na falha, e o `pacing` só na construção.
