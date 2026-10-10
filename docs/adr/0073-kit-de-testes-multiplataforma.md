# ADR 0073 — Kit de testes multiplataforma: perfis de transport

**Status:** Aceito (2026-10-09) · Detalha **D52** ([ADR 0052](0052-kit-de-testes-sobre-o-vitest.md))
e **D22** ([ADR 0022](0022-kit-de-autor.md)) · Segue **D70**
([ADR 0070](0070-capabilities-multiplataforma.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O `@zapforge/testing` nasceu para o WhatsApp (#285). O `FakeTransport` declara todas as
capabilities, então os testes nunca rodam num transport sem grupos, sem citação ou sem figurinha.
Um plugin passa no teste e é recusado no boot no Telegram, no Discord ou no web. O remetente e o
contato da sessão padrão têm telefone.

A investigação mostrou que parte da issue já foi resolvida pelas MPs anteriores. O `receive()`
aceita `Chat` com `kind`, `parentId` e `tenantId` (thread, servidor, tenant) e `sender` com
`isBot`, `username` e `claims`. Também aceita `attachments` (várias mídias), e o `click()` simula
o botão. Os owners por ID (`{ id }`, ADR 0056) funcionam sem telefone. Faltavam três coisas:

- **Perfis de capability.** Os transports de Telegram, Discord e web ainda não existem. A
  previsão do que cada um declara está na matriz da §6.10 do plano (D70).
- **Formato do contato por plataforma.** No Telegram e no Discord, o contato tem `username` e não
  tem telefone. No web, não tem nenhum dos dois.
- **Estado global.** O `incoming.ts` tinha um `let nextId` de módulo, contra o ADR 0004.

Alternativas consideradas:

- **Perfil em cada pacote de transport.** O perfil "verdadeiro" é o que o transport declara, mas
  três dos quatro transports não existem. Além disso, o plugin passaria a depender do transport só
  para testar.
- **Perfil só no kit, sem verificação.** O perfil `whatsapp` poderia divergir do Baileys sem
  ninguém perceber.
- **Perfil só com as capabilities.** O limite de tamanho e o formato do contato ficariam por conta
  de cada teste. Um plugin que lê `sender.phone` passaria no teste do perfil `telegram`.
- **Padrão sem perfil igual ao `whatsapp`, ou remetente padrão sem telefone.** Isso quebraria os
  testes de botão e de álbum, que contam com todas as capabilities, e o de owners por telefone.
  Também mudaria o comportamento para quem já usa o kit.
- **Helper `forEachProfile`.** Seria API nova acoplada ao Vitest, para algo que o `describe.each`
  já faz.

## Decisão

- **`PROFILES` no kit**, com quatro perfis: `whatsapp`, `telegram`, `discord` e `web`. Cada perfil
  tem as `capabilities`, os `limits` e os contatos padrão, `self` e `sender`. A fonte é a matriz da
  §6.10 do plano. No web, entram só as capabilities confirmadas; as marcadas com #287 ficam de
  fora até o transport nascer.
- **O perfil `whatsapp` é o que o Baileys declara.** Um teste no `transport-baileys` compara os
  dois. Os outros perfis são confirmados quando cada transport nascer, com o mesmo teste.
- **Contato por plataforma.** No `whatsapp`, os contatos têm telefone (`DEFAULT_SELF` e
  `DEFAULT_SENDER`). No `telegram` e no `discord`, têm `username`, `phone: null`, e o `self` tem
  `isBot`. No `web`, têm só ID e nome.
- **Limites:** Telegram com texto de 4096, legenda de 1024 e álbum de 10. Discord com texto e
  legenda de 2000, álbum de 10 e 25 botões. WhatsApp e web sem limites, como o Baileys hoje. A
  medida é a padrão (UTF-16 do texto visível), já que o kit não renderiza a marcação do Discord.
- **`new FakeTransport({ profile })` e `createTestBot({ profile })`.** As opções `capabilities`,
  `limits` e `self` do transport substituem o campo do perfil. O `createTestBot` recusa `profile`
  junto com `transport`. O `receive()` e o `click()` usam o `sender` do perfil como base.
- **Sem perfil, nada muda:** todas as capabilities, sem limites, e os contatos com telefone.
- **O contador de IDs do `receive()` fica no `TestBot`**, e não mais no módulo.
- **Matriz de teste:** o autor itera sobre `PROFILE_NAMES` com `describe.each`. O template de
  plugin (#121) usa isso.

## Consequências

- Mudança aditiva no `@zapforge/testing`: `PROFILES`, `PROFILE_NAMES`, `TransportProfile`,
  `ProfileName`, a opção `profile` e o campo `FakeTransport.profile`. Nenhum teste existente muda.
- Os IDs gerados pelo `receive()` (`in-1`, `in-2`...) recomeçam em cada `TestBot`. Antes, dois bots
  no mesmo arquivo dividiam a sequência.
- Os perfis de Telegram, Discord e web são previsão. Quando um transport nascer e declarar algo
  diferente, o perfil muda numa minor do kit, e o teste do plugin pode passar a falhar. Esse é o
  sinal que se quer.
- O `transport-baileys` passa a ter o `@zapforge/testing` como devDependency, só para o teste de
  sincronia.
