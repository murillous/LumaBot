# ADR 0066 — Objeto bruto da mensagem no `ctx.unsafe.raw()`

**Status:** Aceito (2026-10-09) · Detalha **D11** ([ADR 0011](0011-escape-hatch-unsafe-native.md))
e **D03** ([ADR 0003](0003-transport-abstrato.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O `ctx.unsafe.native` expõe só o cliente ou o socket do transport (#283). A `Message` não leva
nada do formato da plataforma, então componentes, embeds e o token de interação do Discord, ou
as `entities`, o `reply_markup` e a `callback_query` do Telegram, ficavam inacessíveis até pelo
escape hatch. Um plugin específico de plataforma, que já declara `transports: ['discord']`, não
tinha como usar o que a plataforma oferece além do contrato. É também a saída para os campos que
o contrato deixa como `unknown` (#272).

A investigação respondeu às perguntas da issue:

- **Onde o objeto já existe.** O Baileys guarda um `WeakMap<Message, WAMessage>` na
  normalização, para citar no envio, inclusive o da citada. O core não guarda nada.
- **Mensagens que o transport nunca viu.** O clique num botão e o comando nativo chegam como
  `Interaction`, e o kernel monta a `Message` a partir dela (`handleInteraction`,
  `handleNativeCommand`). É justamente onde mora o token de interação e a `callback_query`.
- **Memória.** Com um `WeakMap` chaveado pela `Message`, o objeto bruto vive enquanto a mensagem
  vive. Nada a limpar no `stop()` ou no `disconnect()`.
- **Kit de testes.** O `buildMessage` não precisa de objeto falso por padrão: sem registro, o
  `raw()` devolve `undefined`. O teste de um plugin específico de plataforma registra um.
- **Tipagem por transport.** Um genérico no `unsafe` (`raw<WAMessage>(m)`) seria um cast
  disfarçado: nada no tipo garante o transport. O plugin já sabe o formato ao declarar
  `transports`.
- **O que depende do ponto.** `Unsafe`, `createUnsafeAccess`, o contrato do `Transport`, o
  `createBot` (mensagens de interação), o Baileys e o `FakeTransport`. Tudo cresce por adição.

Alternativas consideradas:

- **`WeakMap` no core, preenchido pelo `createMessage({ raw })`.** O `createMessage` é uma função
  solta da API de adapter, sem bot: o mapa teria de ficar em escopo de módulo, estado global
  (ADR 0004), e o core pagaria um `set` por mensagem mesmo sem ninguém ler.
- **Campo com chave `Symbol` na `Message`.** Custa um campo por mensagem e sobrevive a spread, mas
  um `Symbol` exportado é um campo público com outro nome: qualquer código o lê sem passar pelo
  `unsafe`, sem aviso e sem a regra de `transports`.
- **`native` opaco na `MessageKey`.** Resolve editar e apagar o que o contrato não representa,
  não ler a mensagem. Fica para quando um transport precisar.
- **Genérico por transport no `Unsafe`.** Ver acima.
- **`raw()` só para `Message`, sem interação.** Deixaria de fora o caso que motivou a issue.

## Decisão

- **`ctx.unsafe.raw(message)`** devolve o objeto bruto de onde a mensagem saiu, como `unknown`.
  `undefined` quando o transport não o expõe ou a mensagem não veio dele.
- **Mesmas regras do `native`** (ADR 0011): nunca bloqueia, e a primeira chamada de cada plugin
  loga um `warn` com plugin e transport. Sem `transports` no manifesto, o aviso diz que o plugin
  fica preso ao transport. O aviso do `raw()` é à parte do do `native`, para o log medir os dois
  usos.
- **`Transport.raw?(source: Message | Interaction): unknown`**, opcional. O transport guarda o
  objeto num `WeakMap` da instância, chaveado pelo que emitiu. O formato fica no transport, que é
  quem o conhece, e o core não guarda nada por mensagem.
- **Mensagem de interação.** O `Bot` guarda num `WeakMap` dele a interação de onde montou cada
  mensagem. O `raw()` dessa mensagem pergunta ao transport pela `Interaction`.
- **Identidade, não cópia.** A busca é pelo objeto: `{ ...message }` devolve `undefined`. O
  kernel entrega ao plugin a mesma `Message` que o transport emitiu.
- **Baileys:** `raw()` devolve o `WAMessage` do `nativeOf`, já mantido para citar. A citada traz
  o proto montado do `contextInfo`.
- **Kit:** o `FakeTransport` ganha `setRaw(source, raw)` e `raw(source)`. O `receive()` aceita
  `raw` (também na citada descrita), e o `click()`, `raw` nas opções.

## Consequências

- Mudança aditiva: `Unsafe.raw` é novo, e o `Transport.raw` é opcional. Quem monta um `Unsafe`
  à mão precisa do método novo.
- Um plugin específico de plataforma usa o que a plataforma oferece além do contrato, inclusive
  na interação, sem esperar o core.
- O caminho da mensagem no core não ganha custo: o `raw()` só trabalha quando chamado. A mensagem
  de interação ganha um `set` num `WeakMap`. No Baileys, o custo já existia. Num transport novo, é
  um `set` por mensagem, e ele pode deixar o método de fora.
- O que o plugin buscar no `raw()` indica o que promover ao contrato, como o `native`.
- Eventos que não são mensagem (`reaction`, `group.*`) ficam sem objeto bruto. A entrada é por
  adição, com o mesmo `Transport.raw`, quando houver caso.
