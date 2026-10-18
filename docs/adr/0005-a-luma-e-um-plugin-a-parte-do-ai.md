# ADR 0005 — A Luma é um plugin à parte do `ai`

**Status:** Aceito (2026-10-18)

## Contexto

O M5-1 chama de `plugin-ai` a Luma inteira: provider, histórico, persona, tools, busca e gatilho.
O ADR 0004 já fez do `ai` um serviço de geração (cadeia de modelos, fallback, observers) e deixou
o resto para as sub-issues seguintes. Se a personagem entrasse no `ai`, o resumo, o espontâneo, a
transcrição e a persona usariam um plugin que também decide quando a Luma responde, e a troca de
persona ou a mudança do gatilho obrigaria a editar o plugin de que todos dependem (ADR 0002).

## Decisão

1. **`ai` gera, `luma` é a personagem.** O `ai` segue sem comando nem gatilho. A `luma` depende do
   `ai` (`dependsOn`) e cuida do que é da personagem: quando responder, histórico, persona por
   chat, `!persona`, `!luma` e o prompt. `resumo`, `spontaneous`, `transcribe` e `web-search`
   chamam o `ai` direto, cada um com o seu `purpose` e a sua cadeia `models`.
2. **O tool calling mora no `generate`.** O `ai` lê o ponto `ai.tools` (ADR 0003), oferece só as
   tools que o transport atende (`offeredTools`) e roda cada chamada por `invokeTool`, que devolve
   argumento inválido ao modelo como `invalid-args`. Quem chama passa `toolContext` (a mensagem
   que originou a conversa); sem ele a chamada é só texto, e resumo, persona e transcrição não
   oferecem tool. O limite de passos é `maxToolSteps`.
3. **Tool que já agiu não se repete.** Se o modelo falha depois de uma tool rodar (um lembrete
   criado, uma figurinha enviada), a cadeia **não** tenta o próximo modelo: repetir o efeito seria
   pior que devolver o erro. Sem tool executada, o fallback é o de sempre.
4. **Busca nativa do provider é uma opção do `generate`.** O Google Grounding é uma tool que o
   próprio Gemini executa e não cabe no `ai.tools`. O provider pode declarar `nativeSearch()`; o
   `ai` a oferece quando a chamada pede `nativeSearch: true`, e **pula** o item cujo provider não a
   tem, porque responder sem buscar seria inventar. A busca genérica (Tavily) é o plugin
   `web-search`, que usa o grounding como fallback pelo `ai`.
5. **Modelo por finalidade.** `generate({ models })` troca a cadeia só naquela chamada (#385), com o
   cooldown de 429 compartilhado, e cada plugin que chama a IA expõe `models` na própria config.
6. **A Luma reivindica a mensagem antes de qualquer `await`.** Os listeners começam na mesma
   volta, então o `claim()` tem de vir antes do primeiro `await` para o `spontaneous` (prioridade
   menor) enxergá-lo. A resposta leva o prazo `replyTimeoutMs`, acima dos 30 s dos listeners.
7. **Estado da conversa sem timer.** Histórico e janela do grupo ficam em memória, a expiração é na
   leitura e numa varredura espaçada dentro do `add`, e nada sobrevive ao `stop()`. Um restart
   esquece as conversas, como o legacy. As personas criadas ficam no storage, por chat.
8. **O espontâneo muda em relação ao legacy.** Só reação, decidida pela IA a partir das últimas
   mensagens, com cooldown por chat; sorteio, resposta em texto e puxar assunto saíram (#354).
9. **Transcrição só vai ao modelo.** Quando a Luma ouve um áudio, ela chama a tool
   `transcribe_audio` e o texto não vai ao chat; só o `!transcribe` o mostra (#351).
10. **Métricas por observer.** O `ai-metrics` traduz cada tentativa para o serviço `metrics` do
    `plugin-metrics`, com rótulos de baixa cardinalidade, e calcula o custo na consulta pela
    tabela `prices` (#382). Modelo sem preço aparece sem custo.

## Consequências

- Dois plugins para a "Luma" (`ai` e `luma`), o que o `PARIDADE.md` e a doc explicam. Em troca, o
  `ai` serve a qualquer plugin que precise de IA, e a personagem pode mudar sem tocá-lo.
- O `generate` ganha três campos opcionais (`models`, `toolContext`, `nativeSearch`) e o provider,
  um opcional (`nativeSearch`). Quem já chama o `generate` não muda.
- Sem `safetySettings` do Gemini: o legacy desligava os filtros (`BLOCK_NONE`) e o ADR 0004 deixou
  para quando a persona pedisse. Personas que dependem de linguagem pesada (a "Luma Pistola")
  podem ser recusadas pelo provider; decidir isso é do dono do bot, não do código.
- O histórico em memória não acompanha o bot entre processos nem reinícios. Se isso incomodar, o
  armazenamento no `ctx.storage` cabe atrás de `createHistory` sem mudar o resto.
