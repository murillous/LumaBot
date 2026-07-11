# ADR 0002 — Contexto da Luma em multi-turno com `systemInstruction` (fim do prompt-blob)

**Status:** Aceito (2026-07-10)

## Contexto

O pipeline de contexto da Luma montava **tudo num único turno de texto**:
`[{ role: 'user', parts: [{ text: BLOB }] }]`, onde persona, regras, histórico,
contexto de grupo e a mensagem atual eram concatenados num só bloco
(`PromptBuilder.buildPromptRequest`, agora removido).

Isso trazia problemas concretos:

1. **Embaralhamento das fontes** — persona, histórico, ambiente de grupo e
   mensagem atual chegavam indistintos à IA, todos como um único texto.
2. **Sem papéis reais** — o histórico eram strings planas `"Nome: msg"` /
   `"Luma: resp"`. A IA não recebia `role: 'model'` para as próprias falas, só
   rótulos textuais.
3. **Rótulos forjáveis** — o delimitador era idêntico em histórico, grupo e
   mensagem atual; qualquer usuário podia digitar um rótulo e se passar por outra
   fonte de contexto.
4. **Espontâneo no bucket errado** — o `SpontaneousHandler` gravava a resposta na
   chave `bot.jid` (o grupo inteiro) e persistia prompts-de-sistema como fala do
   usuário, poluindo a memória.
5. **Duplicação da mensagem de grupo** — o `groupBuffer` repetia a mensagem que
   dispara a Luma: ela aparecia no `[CONVERSA DO GRUPO]` **e** como mensagem
   atual.

As forças em jogo:

- **Naturalidade** — a IA responde melhor quando recebe uma conversa em turnos
  reais, não um paredão de texto.
- **Distinção clara das fontes** — a Luma precisa saber o que é a própria fala, o
  que é ambiente de grupo e o que é a mensagem endereçada a ela.
- **Não quebrar testes** — a suíte existente (651 testes) precisava continuar
  verde; o storage do histórico não podia mudar de forma.
- **Contrato `AIPort` já preparado** — a assinatura provider-agnóstica
  `generateContent(contents, systemInstruction)` já existia, mas não era honrada
  de fato (o `systemInstruction` não era usado; o OpenAI dependia de um marcador
  de texto `"[USUÁRIO ATUAL]"`).

Alternativas consideradas:

- **Manter o blob, só com delimitadores mais fortes** — melhora o embaralhamento
  na margem, mas não dá papéis reais, os rótulos seguem forjáveis e o
  `systemInstruction` continua morto. Descartada.
- **`systemInstruction` separado + `contents` multi-turno, honrando o contrato
  `AIPort`** (escolhida).

## Decisão

Nova função `buildConversationRequest({ userMessage, historyTurns, personaConfig,
senderName, groupContext, imageData })` em
`src/core/services/PromptBuilder.js`, que retorna `{ systemInstruction, contents }`.

- **`systemInstruction`** — montado de `SYSTEM_PROMPT_TEMPLATE` /
  `SYSTEM_VISION_PROMPT_TEMPLATE` (`src/config/lumaConfig.js`). Contém **só**:
  identidade/persona (`context`/`style`/`traits`), REGRA DE OURO, CAPACIDADES,
  FERRAMENTAS, a seção nova `[COMO LER A CONVERSA]`, o bloco
  `[CONVERSA DO GRUPO — CONTEXTO AMBIENTE]` (presente apenas quando há grupo, e
  explicitamente rotulado como ambiente, **não** endereçado à Luma),
  `[FORMATO WHATSAPP]` e a data/hora. **Não** contém histórico nem a mensagem
  atual.
- **`contents`** — turnos reais do histórico com papéis (`role: 'user'` /
  `role: 'model'`) vindos de `ConversationHistory.getTurns(hKey)`, seguidos da
  **mensagem atual** como **último turno** `role: 'user'` (texto
  `"senderName: userMessage"`, com `imageData` como segunda part quando houver).
  Turnos `model` órfãos no início são descartados (o Gemini exige começar com
  `user`).
- **`ConversationHistory.getTurns(jid)`** — método novo que deriva o papel pelo
  prefixo `"Luma: "` (robusto a uma poda que corte um par). O storage **não**
  mudou e `getText` continua igual (compatibilidade preservada).
- **Contrato `AIPort` agora efetivo** — `generateContent(contents,
  systemInstruction)`. O `GeminiAdapter` injeta `config.systemInstruction`
  (nativo do Gemini) e o propaga no loop de busca. O `OpenAIAdapter` já recebia
  `(history, systemPrompt, tools)`; o wrapper em `AIProviderFactory` agora repassa
  `systemInstruction` direto e faz a busca em multi-turn — **removido** o hack do
  marcador de texto `"[USUÁRIO ATUAL]"`.
- **`persist` no espontâneo** — `LumaHandler.generateResponse` ganhou
  `options { persist = true }`, gravando o histórico só quando `persist`. O
  `SpontaneousHandler` passa `historyKey = ${bot.jid}:${bot.senderJid}`
  (**alinhado** ao fluxo disparado) e `{ persist: false }` — corrige o bucket
  errado e a poluição do histórico com prompts-de-sistema.
- **Dedup do `groupContext`** — o `LumaPlugin` exclui a mensagem atual do contexto
  de grupo (`#getGroupContext(jid, dropLast)`), acabando com a duplicação.
- **Persona segue por-chat** — decisão do [ADR 0001](0001-personas-custom-por-chat.md)
  mantida; este ADR muda como o contexto é montado, não onde a persona vive.

Ajustes de config corrigidos junto (documentados em `docs/02-nucleo-ia.md`):
limite unificado em **200 caracteres** por bloco (antes o template dizia 150 e os
`traits` diziam 200); `generationConfig` real = `temperature 1.4`,
`maxOutputTokens 8192`, `topP 0.95`, `topK 50`; `models =
["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]`; personas
`pensadora` (default) / `agressiva` / `amigavel` / `intelectual` / `literal`;
10 function declarations em `TOOLS` (`tag_everyone`, `remove_member`,
`create_sticker`, `create_image`, `create_gif`, `clear_history`, `show_help`,
`search_web`, `schedule_reminder`, `create_persona`); histórico com `maxHistory`
80 linhas, `maxHistoryAge` 2h, cleanup 1h.

## Consequências

**Mais fácil:**

- A IA distingue as fontes por construção: própria fala (`role: model`), mensagem
  endereçada (último turno `user`) e ambiente de grupo (bloco rotulado no
  `systemInstruction`) — sem depender de rótulos textuais forjáveis.
- Conversa mais natural — turnos reais em vez de um paredão de texto único.
- Contrato `AIPort` finalmente honrado e provider-agnóstico de verdade: Gemini e
  OpenAI recebem `systemInstruction` pelo mesmo caminho, sem hacks de marcador.
- Espontâneo deixa de poluir a memória e escreve na chave certa.
- Fim da duplicação da mensagem que dispara a Luma.

**Mais difícil / trade-offs:**

- `getTurns` deriva o papel do prefixo `"Luma: "` — a convenção precisa ser
  respeitada por quem gravar histórico; mudar o rótulo quebra a derivação de
  papéis.
- Dois formatos de leitura convivem sobre o mesmo storage (`getTurns` novo,
  `getText` legado por compatibilidade) — ponto de atenção para não divergirem.
- O contrato passa a exigir que todo adapter de IA respeite `systemInstruction`
  separado; um provider futuro sem suporte nativo terá de emular esse papel.
- Turnos `model` órfãos no início são silenciosamente descartados para satisfazer
  a exigência do Gemini de começar com `user` — comportamento a ter em mente ao
  depurar históricos curtos.

O [ADR 0001](0001-personas-custom-por-chat.md) (persona por-chat) segue **válido**;
esta decisão não o substitui. Substituível por um ADR futuro caso o contrato de
contexto precise mudar (ex.: suporte a múltiplas mídias por turno ou a um provider
sem `systemInstruction` nativo).
