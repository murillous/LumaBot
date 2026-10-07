# ADR 0048 — `connect()` resolve ao iniciar a tentativa; queda antes do fim não se perde

**Status:** Aceito (2026-10-07) · Detalha **D03** ([ADR 0003](0003-transport-abstrato.md)),
**D39** ([ADR 0039](0039-fila-de-saida-e-conexao.md)) e **D45**
([ADR 0045](0045-queda-de-rede-nao-limpa-sessao.md))

## Contexto

O contrato de `Transport.connect()` dizia só "inicia a conexão; o andamento chega por
`connection.status`". Ele não fixava **quando** o `connect()` resolve (ao iniciar a tentativa ou
no `open`) nem o que o kernel faz com um `closed` que chega antes disso (#253). Daí saíam dois
defeitos:

- **Queda perdida.** O reconector só agia depois do `activate()`, que o `start()` chama quando o
  `connect()` resolve, e ignorava um `closed` com um `connect()` de reconexão em andamento. Um
  `closed` antes do fim do `connect()`, seguido de um `connect()` que resolve sem erro, não tinha
  quem o tratasse: o bot ficava `running` sem conexão para sempre, com a fila de saída pausada.
  No Baileys o caso é comum: logo depois de escanear o QR, o servidor fecha a conexão pedindo
  restart (código 515), e o adapter precisa reconectar.
- **Fila despausada antes do `open`.** A fila nascia despausada. Com um `connect()` que resolve
  antes do `open`, os envios do `setup` e dos jobs vencidos no downtime (o scheduler liga logo
  depois do `connect()`) iam para um socket ainda fechado e gastavam o retry.

Alternativas consideradas:

- **`connect()` resolve no `open`.** O adapter teria de esperar o pareamento por QR, que pode
  levar minutos, e o `start()` ficaria parado nele. Uma queda durante essa espera ainda precisaria
  de regra, e cada adapter implementaria a espera do seu jeito.
- **Reconector descarta o `closed` e o `connect()` rejeita quando a tentativa cai.** Exige que o
  adapter ligue o fechamento do socket ao `connect()` em andamento, o que é frágil, e não cobre a
  queda que vem logo depois de o `connect()` resolver.
- **Scheduler liga no primeiro `open`.** O boot ganharia um caminho a mais (o `start()` resolve
  antes do scheduler), sem ganho sobre a fila pausada: um job sem envio pode rodar sem conexão, e
  os envios dele já esperam.

## Decisão

- `connect()` resolve assim que a tentativa começou (socket criado), sem esperar o `open`. Rejeita
  só se nem deu para começar. Daí em diante, o andamento e as falhas chegam só por
  `connection.status`: o transport emite `open` quando dá para enviar e `closed` se a tentativa
  cair, mesmo antes de o `connect()` resolver.
- O reconector guarda o último `closed` que chegou quando ele não podia agir: antes do
  `activate()` ou com um `connect()` de reconexão em andamento. Quando o `connect()` termina (no
  `activate()` ou no fim da reconexão), ele decide sobre esse `closed`, com o motivo que o
  transport deu. Um `open` depois do `closed` o anula: a conexão está de pé. Uma reconexão já
  agendada (timer) segue cobrindo quedas novas, porque o `connect()` dela ainda não começou.
- A fila de saída fica pausada desde o `start()` até o primeiro `open`. O teto (`maxPauseMs`, 60 s)
  conta desde o `start()`, como qualquer pausa: um pareamento por QR mais longo que isso rejeita
  os envios do `setup` com `'disconnected'`, e os envios voltam a sair no `open`.
- O scheduler segue ligando logo depois do `connect()`. Os envios dos jobs vencidos esperam o
  `open` na fila pausada.

## Consequências

- Todo transport precisa emitir `open`: o que nunca o emite não envia nada (os envios rejeitam
  com `'disconnected'` depois do teto). O adapter Baileys (M2-1) segue este contrato.
- O restart pedido pelo servidor depois do pareamento reconecta pela política, com o backoff da
  queda.
- Um job vencido que envia pode estourar o próprio prazo esperando o primeiro `open`, ou rejeitar
  com `'disconnected'` depois do teto.
- `bot.settled()` espera a fila de saída esvaziar: com envios esperando o primeiro `open`, ele
  espera também, até o `open` ou o teto.
- O caminho quente não muda: a decisão sobre o `closed` guardado só roda nas transições de
  conexão.
