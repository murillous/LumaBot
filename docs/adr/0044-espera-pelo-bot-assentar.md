# ADR 0044 — `bot.settled()` espera o bot processar o que recebeu

**Status:** Aceito (2026-10-07) · Detalha **D22** ([ADR 0022](0022-kit-de-autor.md)) e **D34**
([ADR 0034](0034-biblioteca-sem-runner.md))

## Contexto

O `@zapforge/testing` (M2-3, #113) promete `await bot.receive(...)` seguido de asserções sobre o
que foi enviado. Para `receive()` resolver na hora certa, o kit precisa saber quando o bot
terminou de processar a mensagem. Pelo ADR 0029 ele só usa a API pública, e nela não havia como
esperar: as filas têm `onIdle()`, mas são internas (ADR 0034), e `bot.stats()` só permite
polling. Os testes do próprio core usam `vi.waitFor`, que não consegue afirmar que **nada** foi
enviado (#237).

A fila de entrada e a de saída não bastam. Eventos diretos (`reaction`, grupos; ADR 0038) e
`plugin.error` vão ao barramento sem fila e sem ninguém esperar: só o barramento sabe que um
listener deles ainda roda.

Alternativas consideradas:

- **Expor as filas** (ou os `onIdle()` delas). Vaza o interno que o ADR 0034 escondeu e deixa
  para o chamador o laço entre as filas e o barramento.
- **`idle()`**, o nome da issue. Colide com `BotState` `'idle'`, que quer dizer "nunca iniciado":
  `bot.state === 'idle'` e `await bot.idle()` diriam coisas diferentes.
- **Contar os jobs do scheduler em andamento.** Job não é algo recebido: é disparado pelo relógio,
  e o kit vai controlá-lo pelo relógio. Contar exigiria expor o estado do scheduler ao bot sem um
  caso concreto pedindo.
- **Rejeitar ou resolver com a fila de saída pausada.** Resolver diria "assentou" com mensagens
  esperando; rejeitar faria um teste de reconexão tratar erro onde não há falha.

## Decisão

- `Bot.settled(): Promise<void>` resolve quando, numa mesma conferência síncrona, a fila de
  entrada está vazia, nenhum listener assíncrono está em andamento e a fila de saída está vazia.
  Enquanto não estiver, espera as três de novo, nessa ordem: uma realimenta a outra (o prazo de
  um listener estoura e o `plugin.error` nasce no mesmo passo).
- O barramento conta os listeners assíncronos em andamento. O que estoura o prazo deixa de contar
  (segue em segundo plano, ADR 0042). Isso cobre eventos diretos, `plugin.error` e
  `connection.*`.
- Chamado com o bot em `starting`, espera o boot assentar: os eventos diretos do boot esperam o
  fim dele fora do barramento.
- Fila de saída pausada: espera, como o `onIdle()` dela. O teto é o `maxPauseMs` (ADR 0039).
- Jobs do scheduler e trabalho que o plugin agenda sozinho (timer, promise solta) ficam de fora.
- Nunca rejeita. Antes do `start()` e depois do `stop()`, resolve na hora.
- É método do `Bot`, já exportado: a lista de exports de `entries.test.ts` não muda.

## Consequências

- O kit de testes implementa `receive()` como "emite no transport de teste e `await
  bot.settled()`", e asserções negativas passam a ser seguras.
- O caminho quente paga um incremento e um decremento por listener assíncrono; a espera em si só
  roda quando alguém chama.
- Um handler preso segura o `settled()` até o prazo dele (30 s por padrão). Com os intervalos
  padrão da fila de saída, cada envio espera de verdade: o kit zera os intervalos pela config.
- Se um caso pedir jobs dentro da espera, o scheduler ganha a contagem e este ADR é substituído.
