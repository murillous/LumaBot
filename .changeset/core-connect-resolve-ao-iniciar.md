---
'@zapforge/core': minor
---

Queda durante o `connect()` não deixa mais o bot `running` sem conexão (#253, ADR 0048). O
contrato de `Transport.connect()` agora diz que ele resolve ao iniciar a tentativa, sem esperar o
`open`. Um `closed` que chega antes de o `connect()` terminar (o inicial ou o de uma reconexão) é
guardado e decidido quando ele termina, a menos que um `open` venha depois. A fila de saída
fica pausada desde o `start()` até o primeiro `open`, então os envios do `setup` e dos jobs
vencidos esperam a conexão (até `outbound.maxPauseMs`, contado desde o `start()`). **Atenção,
adapters:** o transport precisa emitir `connection.status` `open`, ou nada é enviado.
