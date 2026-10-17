# ADR 0004 — Providers da IA pelo AI SDK, com cadeia entre providers

**Status:** Aceito (2026-10-17)

## Contexto

O legacy fala com a IA por adapters escritos à mão (`GeminiAdapter`, `OpenAIAdapter` também
servindo o DeepSeek) e um loop de tools próprio (`ToolDispatcher`). Esse caminho tem débitos:

- só um provider por vez (`AI_PROVIDER`), e o fallback existe só entre modelos Gemini;
- qualquer erro troca de modelo, até o que se repetiria no próximo;
- o modelo em rate limit é tentado primeiro em toda mensagem;
- a busca web fica dentro dos adapters, duplicada nos dois caminhos;
- um `temperature` só para todos, embora a escala mude entre providers.

O M5-1.1 (#346) pede Gemini, OpenAI, DeepSeek e Claude com fallback, e o M5-1.4 vai precisar de
tool calling nos quatro.

## Decisão

1. **Vercel AI SDK (`ai` + `@ai-sdk/*`).** Um formato de mensagem (`ModelMessage`) e um
   `generateText` para todos os providers, e o tool calling dele aceita schema Zod, como o
   `ai.tools` (ADR 0003). O serviço expõe os tipos do SDK direto, sem tipo próprio por cima.
2. **Uma cadeia mista, em ordem.** `models` lista itens `provider:modelo`, e cada item tem os
   próprios `temperature` e `maxOutputTokens`. A cadeia não tem padrão no código: nome de modelo
   envelhece.
3. **Só erro transitório avança na cadeia.** Usa o `isRetryable` do `APICallError` (408, 409,
   429, 5xx, rede) e o timeout por tentativa. O resto relança. O retry do SDK fica desligado
   (`maxRetries: 0`), e quem tenta de novo é a cadeia.
4. **429 põe o modelo em cooldown.** Durante `cooldownMs` ele vai para o fim da cadeia, mas não
   sai dela: com todos em 429, ainda vale tentar.
5. **Providers por ponto de extensão (`ai.providers`).** Segue o ADR 0002: o `ai` é dono do ponto
   e contribui os quatro embutidos por ele, só os que têm chave. Provider novo é um plugin novo.
   O provider é resolvido a cada chamada, porque quem contribui carrega depois do `ai`.
6. **Medir é extensão (`ai.observers`).** O `ai` emite um registro por tentativa (modelo,
   `purpose` de quem chamou, posição na cadeia, desfecho, latência, uso de tokens,
   `finishReason`) e não agrega nada. Métrica para o dashboard, exportação para o Grafana e
   custo em US$ por 1M de tokens são plugins que contribuem observers. O observer roda sem ser
   esperado, e a falha dele vai só para o log.
7. **Sem cadeia, o bot sobe.** Config inválida derruba o boot (ADR 0102 do Bridger), então
   `models` vazio é válido: o log avisa e o `generate` recusa com `AiUnavailableError`.

## Consequências

- Os adapters e o loop de tools do legacy não são portados; o M5-1.4 usa o `tools` do
  `generateText`, alimentado por `ai.tools`.
- O Google Grounding, que é nativo do Gemini, fica como opção do provider. A busca web genérica
  (Tavily) vira um plugin que contribui tool em `ai.tools`.
- O app passa a depender do SDK e de quatro pacotes de provider. A troca de major do SDK mexe
  só no `ai`.
- O `safetySettings` do Gemini (`BLOCK_NONE` no legacy) ainda não foi portado: entra com a
  persona (M5-1.3) se fizer falta.
