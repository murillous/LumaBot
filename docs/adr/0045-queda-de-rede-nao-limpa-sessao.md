# ADR 0045 — Queda de rede nunca limpa a sessão

**Status:** Aceito (2026-10-07) · Detalha **D03** ([ADR 0003](0003-transport-abstrato.md)) e
**D37** ([ADR 0037](0037-transport-por-fabrica.md))

## Contexto

A `ReconnectionPolicy` veio do legacy quase como estava: `connection-lost` e `unknown` reconectam
com backoff (5, 10, 15 s) e, esgotadas `maxReconnectAttempts` (3), a decisão era `clean-session`
com causa `reconnect-limit`. Um `connect()` de reconexão que falha conta como queda, então ~30 s de
rede fora bastavam para esgotar o limite.

No legacy, limpar ali era acidente de implementação (`reconnect()` → `cleanAndRestart()`). Com o
ADR 0037, virou comportamento automático: com transport por fábrica, o `clean-session` limpa o
`auth` sem configuração. Resultado: uma queda de rede apagava credenciais válidas, e alguém
precisava ir até o celular parear de novo (#236).

A credencial não depende de quanto tempo a rede ficou fora. Quem diz que ela deixou de valer é o
aparelho (`logged-out`) ou o servidor (`auth-failed`).

Alternativas consideradas:

- **Manter o limite, decidindo `stop` em vez de `clean-session`**: o processo cai e o supervisor
  (PM2, Docker) reinicia com as credenciais intactas. Funciona, mas depende de supervisor, e o
  reinício só volta a tentar a mesma conexão, com o processo inteiro subindo de novo.
- **Limite opcional que para o bot**: sem uso concreto hoje; opção nova sem caso que a peça.
- **Manter e documentar o risco**: deixa o padrão destruir estado que só um humano repõe.

## Decisão

- `connection-lost` e `unknown` reconectam **sem limite de tentativas**, com o backoff (padrão
  5 s × tentativa, até 15 s). `server-error` segue com atraso fixo, também sem limite.
- `clean-session` só para `logged-out`, `auth-failed` e `qr-limit` (QRs sem pareamento, que
  acontece antes de haver credencial a perder).
- Saem a causa `reconnect-limit` e a opção `maxReconnectAttempts`. `reconnectAttempts` continua no
  estado da política: escolhe o atraso do backoff e aparece no log.
- O teto da pausa da fila de saída (`outbound.maxPauseMs`, 60 s, ADR 0039) fica como está. Ele
  foi dimensionado pelo ciclo de 5 + 10 + 15 s, que deixou de ter fim; agora vale pelo que mede:
  quanto tempo uma resposta ainda faz sentido. Numa queda maior, as respostas pendentes rejeitam
  com `'disconnected'` e o bot segue tentando reconectar.

## Consequências

- Rede fora por horas não exige pareamento: o bot reconecta quando ela voltar, a cada 15 s.
- O bot nunca desiste de uma queda de rede sozinho. Quem quer desistir (alertar, parar após N
  minutos) observa `connection.status` e chama `bot.stop()`.
- Um adapter que mapear erro de rede para `auth-failed` volta a apagar credenciais: o mapeamento
  do `DisconnectReason` precisa reservar `logged-out`/`auth-failed` para rejeição real da
  credencial (vale para o adapter Baileys, M2-1).
- Quebra de API em 0.x: quem passava `maxReconnectAttempts` recebe erro de tipo, e quem tratava a
  causa `reconnect-limit` deixa de recebê-la.
