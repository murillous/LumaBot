# ADR 0080 — Açúcar para o autor de transport: `defineTransport` e coerência no `createBot`

**Status:** Aceito (2026-10-10) · Detalha **D03** ([ADR 0003](0003-transport-abstrato.md)),
**D10** ([ADR 0010](0010-capabilities-do-transporte.md)) e **D37**
([ADR 0037](0037-transport-por-fabrica.md)) · Par do **D79**
([ADR 0079](0079-acucar-no-manifesto-do-plugin.md))

## Contexto

O ADR 0079 tirou a cerimônia do plugin. O transport tem a dele (#324). Todo adapter repete o
mesmo esqueleto: um `TypedEmitter`, o `on()` que delega a ele e o log do erro de handler; o `Set`
de capabilities montado à mão; um método que só lança `UnsupportedError` para cada capability que
não tem (três no `transport-web`); o `assertCanSend` no começo do `send`; e o `self`.

Em JavaScript, nada confere o adapter. Um método faltando só aparece como `TypeError` no meio do
kernel, quando um plugin o usa. Uma capability com erro de digitação (`'send.txt'`) passa em
silêncio, e o plugin que a exige é pulado sem motivo aparente.

A investigação mostrou dois limites:

- **Toda chamada do kernel a um método de capability já confere a capability antes**: as ações
  da fila de saída, os grupos, a humanização (`typing`) e o papel `group-admin`. Um método
  ausente só é chamado se a capability foi declarada.
- **Tornar os métodos opcionais no tipo `Transport` quebra testes existentes**, que chamam
  `transport.sendTyping` e `vi.mocked(transport.react)` sobre o tipo do contrato. O tipo que o
  kernel consome pode seguir completo, desde que o autor não precise escrever os stubs.

Alternativas consideradas:

- **Métodos opcionais no `Transport`.** Mudaria as chamadas do kernel e quebraria o typecheck de
  testes existentes, sem ganho para o autor que o `defineTransport` não dê.
- **Classe base `BaseTransport`.** Combina com os adapters em classe, mas obriga quem escreve um
  transport simples em JS a herdar, e esconde no protótipo o que a descrição mostra.
- **Só a checagem no `createBot`.** Resolve o erro silencioso, mas mantém o emissor, o `Set` e os
  stubs com o autor.

## Decisão

- **`defineTransport(build)`** em `@zapforge/core/adapter`. O `build(deps, kit)` devolve uma
  `TransportSpec`: o contrato sem `on` e `self`, com `capabilities` em lista e os métodos de
  capability (`react`, `edit`, `delete`, `sendTyping`, `getGroupMetadata`,
  `updateGroupParticipants`) opcionais, como `raw`, `isChatAdmin`, `native`, `limits` e `pacing`.
  O resultado é a fábrica do ADR 0037.
- **O kit** traz `emit(evento, payload)`, sobre um `TypedEmitter` cujo erro de handler vai para o
  `deps.log`, e `setSelf(contato)`, que alimenta o `Transport.self`.
- **O transport montado** confere a capability no `send` (`assertCanSend`) e em cada método antes
  de chamar o da descrição, com `this` nela. O método não implementado rejeita com
  `UnsupportedError`. `raw`, `isChatAdmin`, `limits` e `pacing` só aparecem se a descrição os tem.
- **A descrição inválida** lança `TypeError` com todos os problemas: capability desconhecida,
  capability sem o método dela, `connect`, `disconnect` ou `send` faltando, nome vazio,
  `capabilities` que não é lista. O `createBot` o converte em `BotConfigError`, como qualquer erro
  da fábrica.
- **O `createBot` confere todo transport**, de fábrica ou instância: `name`, `connect`,
  `disconnect`, `on`, `send`, capabilities conhecidas e o método de cada capability declarada.
  Recusa com `BotConfigError`. Em runtime, só os métodos das capabilities declaradas são
  exigidos, então o objeto escrito à mão pode omitir os outros.
- **O tipo `Transport` não muda.** A classe com `implements Transport` segue escrevendo os stubs,
  e os adapters existentes (`baileys`, `web`, os de teste) seguem válidos sem mudança.

## Consequências

- Um transport mínimo cabe em `name`, `capabilities`, `connect`, `disconnect` e `send`.
- A capability com erro de digitação e o método faltando passam a derrubar o `createBot`, com a
  lista do que está errado. Antes, apareciam só quando um plugin usava o recurso.
- `defineTransport`, `TransportSpec` e `TransportKit` saem em `@zapforge/core/adapter`.
- A checagem roda uma vez, no `createBot`. O caminho quente não muda para os adapters em classe;
  no do `defineTransport`, cada chamada passa por um invólucro com a checagem de capability.
- Fica de fora: um helper para o `raw` (o `WeakMap` do ADR 0066) e a idempotência automática do
  `disconnect()`. Entram por adição se os próximos transports (Telegram, Discord) pedirem.
