# ADR 0039 — Fila de saída pausa com a conexão caída e tem prazo por envio

**Status:** Aceito (2026-10-07) · Detalha a decisão **D19** ([ADR 0019](0019-fila-de-saida-anti-ban.md)) na parte do retry

## Contexto

A fila de saída não sabia do estado da conexão (#198). Numa queda, cada envio tentava 3 vezes com
backoff de ~1 s e ~2 s e desistia em cerca de 3 s, mas a primeira reconexão da
`ReconnectionPolicy` só sai depois de 5 s (backoff 5, 10 e 15 s). Toda resposta gerada durante uma
queda se perdia.

Um defeito vizinho, da mesma fila (#202, item 3): sem prazo por envio, um `transport.send` que
nunca resolve prende o chat para sempre e segura o `close()` até estourar o prazo do gancho de
parada. Não há prova de que o Baileys faça isso, mas o core não deve depender de cada adapter
ter seu próprio timeout.

Alternativas consideradas:

- **Aumentar o retry padrão** para cobrir o ciclo de reconexão. Gasta tentativas às cegas e, com
  a conexão de pé, faz uma falha permanente demorar a aparecer.
- **A fila assinar o `connection.status` do transport.** A fila passaria a conhecer o transport
  além de `send` e `sendPresence`.
- **Sem teto de espera.** Num re-pareamento por QR, respostas sairiam minutos depois, fora de
  contexto, e o backlog cresceria até o `maxPending`.
- **Prazo por envio no contrato do adapter**, sem timeout no core. Cada adapter teria de lembrar
  disso, e o kernel não teria como se proteger do que esqueceu.

## Decisão

- A fila ganha `pause()` e `resume()`. O `Bot` pausa no `connection.status` `closed` e retoma no
  `open`; a fila segue sem conhecer o transport além do envio.
- Pausada, a fila não despacha. O que aguarda e o que chegar esperam a retomada. O envio em
  andamento termina e, se falhar, a re-tentativa também espera, sem gastar as tentativas que
  restam.
- O teto da pausa é `outbound.maxPauseMs`, com padrão de 60 s, que cobre o ciclo de reconexão
  padrão. Estourado o teto, o que aguarda rejeita com `OutboundQueueError` `'disconnected'`, e os
  envios novos rejeitam na hora até a conexão abrir. `Infinity` desliga o teto.
- No `stop()` com a fila pausada, o `Bot` descarta o que aguarda (`close({ drain: false })`) em vez
  de drenar: a reconexão já parou, e a drenagem só gastaria o prazo. Isso cobre o `'replaced'`, que
  para o bot (ADR 0036).
- Toda chamada da fila ao transport (presença e envio) tem prazo: `outbound.sendTimeoutMs`, com
  padrão de 30 s. Estourado, o envio rejeita com `OutboundQueueError` `'timeout'`, **sem
  re-tentar**, porque a mensagem ainda pode sair e reenviar duplicaria. O chat é liberado. Presença
  sem resposta conta como falha de presença: vai para `onPresenceError` e o envio segue.

## Consequências

- Uma queda curta não perde resposta: ela sai quando a conexão volta.
- O motivo de `OutboundQueueError` ganha `'disconnected'` e `'timeout'`. Um `switch` exaustivo
  sobre `reason` precisa tratar os dois.
- Um envio que falhou bem na hora da queda pode ter sido entregue mesmo assim, e a re-tentativa
  depois da reconexão o duplicaria. O risco já existia com o retry; a pausa não o aumenta.
- Com `reconnection: false`, quem reconecta é o app ou o adapter. Se ninguém reconectar, o teto
  vale do mesmo jeito.
- O teto conta desde a queda, não desde a chegada de cada mensagem: uma mensagem que chega aos
  50 s de queda espera no máximo mais 10 s.
- O custo é um timer por chamada ao transport, criado e cancelado a cada envio. É desprezível
  perto da taxa da fila (~3 msg/s).
