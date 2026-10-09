# ADR 0056 — Owners por telefone ou por ID do contato

**Status:** Aceito (2026-10-09) · Detalha **D24** ([ADR 0024](0024-papeis-no-core.md)) e
**D46** ([ADR 0046](0046-ids-de-contato-e-metadata-de-grupo.md)) · Parte do kernel
multiplataforma ([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O papel `owner` só reconhecia telefone (#267). A config aceitava só telefones (8 a 15 dígitos,
`BotConfigError` para letra e `@`), e o roteador comparava `owners` com `sender.phone`, nunca com
`sender.id`, porque no WhatsApp o ID pode ser um LID de onde não sai o número (M1-16.4).

Discord, Telegram e web não têm telefone: `sender.phone` é `null`, e ninguém conseguia ser owner
nem, portanto, superusuário do `group-admin`. Também não dava para escrever o ID nativo: um
snowflake do Discord tem de 17 a 20 dígitos e falhava na validação, e um ID do Telegram passava
na regex, mas era comparado com `phone` e nunca casava.

Alternativas consideradas:

- **Texto livre.** Só dígitos com tamanho de telefone valeria como telefone **e** como ID;
  qualquer outra coisa, só como ID. É mais curto de escrever, mas é ambíguo: um ID do Telegram de
  10 dígitos parece telefone, e o ID de uma pessoa pode ter o texto do telefone de outra no mesmo
  transport. Um erro de digitação num telefone também deixaria de ser erro no boot e viraria um ID
  que nunca casa.
- **Normalização do ID pelo transport** (porta opcional, por exemplo LID ↔ JID no WhatsApp). Não
  é necessária: no WhatsApp o telefone já resolve, e nas outras plataformas o ID é estável.

## Decisão

- Cada entrada de `owners` é **um telefone (string) ou `{ id }`**. A string continua sendo
  telefone, normalizada como antes, e a config atual segue válida sem mudança.
- `{ id }` é comparado por igualdade exata com `sender.id`; o telefone, com `sender.phone`. Os
  dois espaços nunca se cruzam: não há ambiguidade entre ID e telefone.
- Como cada `Bot` tem um transport só (ADR 0004, ADR 0055), o ID está sempre no espaço daquela
  plataforma.
- `{ id }` precisa de texto não vazio e sem espaço nas pontas; o resto é `BotConfigError` no
  `createBot`. Número não é aceito: um snowflake do Discord passa de 2^53 e perderia precisão.
- O tipo da entrada não sai no entry público: `BotConfig['owners']` já tipa o literal.

## Consequências

- Owner em Discord, Telegram e web passa a ser possível, e com ele o superusuário do
  `group-admin`.
- Mudança aditiva: o tipo de `BotConfig.owners` se alarga de `string[]` para
  `(string | { id: string })[]`.
- No WhatsApp, um JID em `{ id }` só casa quando o remetente chega naquele espaço (LID ou JID de
  telefone, ADR 0046). A doc recomenda o telefone nessa plataforma.
- Custo por comando: um `Set.has` a mais na verificação de papel.
