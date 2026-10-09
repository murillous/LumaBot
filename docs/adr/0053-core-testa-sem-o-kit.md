# ADR 0053 — O core se testa com apoios próprios, não com o `@zapforge/testing`

**Status:** Aceito (2026-10-08) · Detalha **D22** ([ADR 0022](0022-kit-de-autor.md)) e
**D52** ([ADR 0052](0052-kit-de-testes-sobre-o-vitest.md))

## Contexto

A #112 (M2-3) pedia que os testes do core usassem o kit. Só que o `@zapforge/testing` depende do
`@zapforge/core` (`createBot`, `createMessage`, os helpers de capability, o `TypedEmitter`). Para o
core importar o kit, as dependências virariam um ciclo. O `tsc -b` não aceita referências
circulares, e com o ciclo a ordem do `pnpm -r build` fica indefinida.

O core se testa com apoios internos, que não são exportados: o `TestTransport` e o `textMessage()`
(`src/transport/fake-transport.test-support.ts`), e o `RecordingTransport`, o `recordingLogger` e
o `message()` (`src/bot/harness.test-support.ts`). Esses arquivos repetem parte do `FakeTransport`
e do `receive()` do kit. Eles também testam coisas que o kit não oferece, porque não servem a
quem escreve plugin: `connect()` que falha ou trava, ordem de `connect`/`disconnect` e grupo
pronto em `getGroupMetadata`. Hoje são 26 arquivos de teste do core que usam esses apoios.

Havia quatro caminhos (#263):

- **Mover os testes de ponta a ponta do `Bot`** para um pacote que dependa do core e do kit.
  São cerca de 20 arquivos movidos, e eles verificam detalhes internos do bot que a API pública
  não mostra.
- **Levar o `FakeTransport` para o core**, num entry `@zapforge/core/testing` que o kit
  reexporta. Isso aumenta a API pública do core, muda o ADR 0034 e o `entries.test.ts`, e obriga
  a migrar os 26 arquivos. O `FakeTransport` ainda teria de ganhar os casos de falha de conexão,
  que não fazem sentido para o autor de plugin.
- **Aceitar o ciclo só nos testes**, com os testes do core fora do `tsc -b` do pacote. Isso
  quebra a premissa das project references.
- **Manter os apoios do core** e aceitar a duplicação.

## Decisão

- O core continua testado com os apoios internos. Ele **não depende** do `@zapforge/testing`, nem
  como devDependency.
- O kit é testado contra o core real: o `createTestBot` monta um `Bot` de verdade com o
  `createBot`, e os testes do `@zapforge/testing` passam pelo pipeline inteiro.
- O que impede os dois fakes de divergirem é o contrato, não o código compartilhado. Os dois
  implementam a interface `Transport`, que o `tsc` confere, e checam capability com os mesmos
  `assertCanSend` e `assertCapability` do core. Uma mudança no contrato quebra os dois.
- O critério de aceite da #112 passa a ser: "o kit é testado contra o core real, e os apoios
  internos do core seguem o mesmo contrato do `Transport`".

## Consequências

- O grafo de dependências continua sem ciclo, e a API pública do core não muda.
- Fica a duplicação de cerca de 100 linhas entre o `TestTransport` e o `FakeTransport`. O
  comportamento comum (eventos, capabilities, `disconnect` idempotente) vem do core. O que se
  repete é o registro dos envios.
- Uma mudança no `FakeTransport` que não seja de contrato, como um registro novo, não chega aos
  apoios do core, e não precisa chegar.
- Vale rever esta decisão se o kit passar a cobrir o que hoje só os apoios do core têm, como
  falha de conexão. Aí a opção do entry `@zapforge/core/testing` passa a compensar a migração.
