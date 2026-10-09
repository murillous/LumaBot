---
'@zapforge/core': minor
---

A fila de saída respeita a janela que a plataforma informa e o ritmo do transport (ADR 0067).

- Erro do transport com `retryAfterMs` (ms, finito e ≥ 0) re-tenta depois dessa janela exata, no
  lugar do backoff. Com `retryAfterScope: 'global'`, nenhum chat envia antes de ela abrir, mesmo
  que o envio que falhou não re-tente. Janela acima de `retry.maxDelayMs` rejeita com o erro do
  transport, sem re-tentar. A janela conta em `maxAttempts` e não muda o que é re-tentável.
- `Transport.pacing` opcional (tipo `TransportPacing`, com `globalIntervalMs` e `chatIntervalMs`)
  dá o ritmo padrão da fila. A config do bot sobrescreve campo a campo; sem nenhum dos dois, vale
  o padrão de antes (300 ms e 1000 ms). Valor inválido no `pacing` lança `RangeError`.
- `docs/transport.md` documenta o mapeamento das respostas da plataforma: 400, 401, 403, 404 e
  413 viram `retryable: false`, e 429 vira `retryAfterMs`.
