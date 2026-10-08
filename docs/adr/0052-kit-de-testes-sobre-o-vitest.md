# ADR 0052 — Kit de testes sobre o Vitest, com `receive()` que espera o bot assentar

**Status:** Aceito (2026-10-07) · Detalha **D22** ([ADR 0022](0022-kit-de-autor.md)) e
**D44** ([ADR 0044](0044-espera-pelo-bot-assentar.md))

## Contexto

O `@zapforge/testing` é o kit para autores de plugin (D22). O plano (§6.9) fixa o uso:

```ts
const bot = await createTestBot({ plugins: [sticker()] });
await bot.receive({ text: '!s', image: fixtureBuffer });
expect(bot.sent).toContainSticker();
```

Para que esse exemplo funcione, duas escolhas precisavam ser feitas. A primeira é de onde vêm os
matchers (`toContainSticker`, `toHaveReplied`...). A segunda é quando o `receive()` resolve,
porque o bot processa a mensagem por filas assíncronas.

Para os matchers, havia três caminhos:

- **Sem matchers**: o kit entrega só o array `sent`, e o teste usa os matchers padrão. Funciona
  com qualquer framework, mas `toContainSticker()` vira `expect(sent.some((s) => s.content.type ===
  'sticker')).toBe(true)`, e a falha não mostra o que foi enviado.
- **Entry separado** (`@zapforge/testing/vitest`): matchers opcionais. Cada teste precisa de mais
  um import, e o exemplo do plano deixa de funcionar como está escrito.
- **Matchers no import do pacote**, com o Vitest como peer dependency.

## Decisão

- O kit é **do Vitest**, que é o runner do monorepo e do template de plugin. O `vitest` é peer
  dependency, e importar `@zapforge/testing` registra os matchers (`expect.extend`) e os tipos
  (augmentation de `Matchers` do módulo `vitest`).
- Os matchers aceitam `bot.sent` ou o próprio `TestBot`. Quando falham, a mensagem lista o que foi
  enviado.
- O **`receive()` entrega a mensagem pelo transport e resolve depois do `bot.settled()`** (D44).
  Quando ele resolve, os envios que a mensagem causou já estão em `sent`, inclusive os feitos sem
  `await`. O `emit()` faz o mesmo para os outros eventos.
- O `createTestBot` usa padrões próprios para teste: log `silent`, `env: {}` (nenhum `ZAPFORGE_*`
  da máquina entra na config), fila de saída sem intervalo e sem reconexão. O `FakeTransport`
  declara todas as capabilities, e quem quiser testar a falta de uma passa a lista.

## Consequências

- O exemplo do plano roda como teste, sem configuração no `vitest.config`.
- Quem usa Jest ou `node:test` não consegue usar o pacote, porque o import exige o `vitest`. Um
  entry sem matchers pode ser criado depois, por adição, se houver demanda.
- O teste não precisa de `sleep` nem de polling. Um job do scheduler não entra no `settled()`, e
  o teste dele chama o handler ou espera o job diretamente.
- O `FakeTransport` segue o contrato do `Transport`, inclusive o `UnsupportedError`. O plugin
  testado no kit falha do mesmo jeito que falharia no Baileys.
