# Fase 5 — Multi-Provider de IA

> **Status:** ⏳ Planejada  
> **Branch:** `feat/phase-5-multi-ai-provider`  
> **Base:** `develop` (merge da Fase 4 primeiro)  
> **Objetivo:** Trocar o provider de IA via variável de ambiente, sem alterar nenhum código de negócio

---

## O problema que esta fase resolve

O LumaBot está 100% amarrado ao Google Gemini. A `AIPort` definida na Fase 1 é o contrato, mas até aqui só existe o `GeminiAdapter`. Esta fase:

1. Cria o `OpenAIAdapter` como segunda implementação de `AIPort`
2. Implementa seleção de provider via `env.AI_PROVIDER`
3. Garante que **nenhum código de domínio** precisa saber qual provider está ativo

---

## Como a troca funciona

```bash
# .env — para usar Gemini (padrão)
AI_PROVIDER=gemini
GEMINI_API_KEY=sua_chave_aqui

# .env — para usar OpenAI
AI_PROVIDER=openai
OPENAI_API_KEY=sua_chave_aqui
AI_MODEL=gpt-4o-mini
```

O `Bootstrap.js` resolve o adapter correto:

```js
function resolveAIAdapter(env) {
  switch (env.AI_PROVIDER) {
    case 'openai':
      return new OpenAIAdapter({ apiKey: env.OPENAI_API_KEY, model: env.AI_MODEL });
    case 'gemini':
    default:
      return new GeminiAdapter({ apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL });
  }
}

c.register('aiPort', () => resolveAIAdapter(env));
```

O `ChatService` não sabe — e não precisa saber — qual adapter está por baixo.

---

## `OpenAIAdapter` — Implementação de `AIPort`

```js
import OpenAI from 'openai';
import { AIPort } from '../../core/ports/AIPort.js';

export class OpenAIAdapter extends AIPort {
  #client;
  #model;
  #stats = { calls: 0, tokensIn: 0, tokensOut: 0 };

  constructor({ apiKey, model = 'gpt-4o-mini' }) {
    super();
    this.#client = new OpenAI({ apiKey });
    this.#model = model;
  }

  async generateContent(history, systemPrompt, tools = []) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(({ role, parts }) => ({
        role: role === 'model' ? 'assistant' : role,
        content: parts.map(p => p.text ?? '').join(''),
      })),
    ];

    const response = await this.#client.chat.completions.create({
      model: this.#model,
      messages,
      tools: tools.length > 0 ? this.#convertTools(tools) : undefined,
    });

    this.#stats.calls++;
    this.#stats.tokensIn  += response.usage?.prompt_tokens ?? 0;
    this.#stats.tokensOut += response.usage?.completion_tokens ?? 0;

    const choice = response.choices[0];
    const text = choice.message?.content ?? '';
    const functionCalls = (choice.message?.tool_calls ?? []).map(tc => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));

    return { text, functionCalls };
  }

  async processMedia(prompt, media) {
    // OpenAI suporta imagens via content array com type=image_url
    // Para áudio, delega ao Whisper API
    const content = [
      { type: 'text', text: prompt },
      ...media.map(m => ({
        type: 'image_url',
        image_url: { url: `data:${m.mimeType};base64,${m.data.toString('base64')}` },
      })),
    ];

    const response = await this.#client.chat.completions.create({
      model: this.#model,
      messages: [{ role: 'user', content }],
    });

    return response.choices[0]?.message?.content ?? '';
  }

  getStats() {
    return { ...this.#stats };
  }

  // Converte o formato de tools do Gemini para o formato da OpenAI
  #convertTools(geminiTools) {
    return geminiTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}
```

---

## `AnthropicAdapter` (futuro)

O mesmo padrão permite adicionar Claude da Anthropic:

```js
export class AnthropicAdapter extends AIPort {
  // Implementação usando @anthropic-ai/sdk
  // Mapeamento: history → messages[], systemPrompt → system param
}
```

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sua_chave
AI_MODEL=claude-haiku-4-5-20251001
```

---

## Atualizações no `env.js`

```js
export const env = Object.freeze({
  // ... campos existentes ...
  AI_PROVIDER:     process.env.AI_PROVIDER || 'gemini',
  AI_MODEL:        process.env.AI_MODEL || 'gemini-2.0-flash',
  OPENAI_API_KEY:  process.env.OPENAI_API_KEY || undefined,
});
```

Adicionar `OPENAI_API_KEY` à validação condicional:

```js
function validateRequired() {
  const missing = [];

  // Gemini é obrigatório apenas se for o provider ativo
  if (!process.env.AI_PROVIDER || process.env.AI_PROVIDER === 'gemini') {
    if (!process.env.GEMINI_API_KEY?.trim()) missing.push('GEMINI_API_KEY');
  }

  if (process.env.AI_PROVIDER === 'openai') {
    if (!process.env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(`[Config] Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  }
}
```

---

## Testes a criar nesta fase

| Arquivo | O que testa |
|---------|-------------|
| `tests/unit/adapters/OpenAIAdapter.test.js` | `generateContent`, `processMedia`, `getStats`, `#convertTools` |
| `tests/unit/adapters/AIAdapterContract.test.js` | Suite de contrato que roda para Gemini E OpenAI — garante paridade |
| `tests/unit/infra/Bootstrap.test.js` | `AI_PROVIDER=openai` → resolve `OpenAIAdapter`; `gemini` → `GeminiAdapter` |
| `tests/integration/MultiProvider.test.js` | ChatService com OpenAIAdapter mock gera resposta válida |

### Suite de contrato — padrão

```js
// tests/unit/adapters/AIAdapterContract.test.js
function runContractTests(name, createAdapter) {
  describe(`AIPort contract — ${name}`, () => {
    let adapter;
    beforeEach(() => { adapter = createAdapter(); });

    it('implementa generateContent()', async () => {
      const result = await adapter.generateContent([], 'system', []);
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('functionCalls');
      expect(Array.isArray(result.functionCalls)).toBe(true);
    });

    it('implementa processMedia()', async () => {
      const result = await adapter.processMedia('descreva', []);
      expect(typeof result).toBe('string');
    });

    it('implementa getStats()', () => {
      const stats = adapter.getStats();
      expect(typeof stats).toBe('object');
    });
  });
}

// Roda o mesmo contrato para cada adapter
runContractTests('GeminiAdapter', () => new GeminiAdapter({ apiKey: 'fake', model: 'gemini-flash' }));
runContractTests('OpenAIAdapter', () => new OpenAIAdapter({ apiKey: 'fake', model: 'gpt-4o-mini' }));
```

---

## Critérios de saída

- [ ] `OpenAIAdapter` implementando `AIPort` completamente
- [ ] Seleção de provider via `env.AI_PROVIDER` no Bootstrap
- [ ] Validação condicional no `env.js` (só exige a key do provider ativo)
- [ ] Suite de contrato passando para ambos os adapters
- [ ] `AI_PROVIDER=openai` funciona end-to-end sem alterar nenhum serviço de domínio
- [ ] Todos os testes das fases anteriores ainda passando

---

## Métricas de sucesso da refatoração completa

Quando as Fases 0–5 estiverem concluídas, o projeto atende a:

| Métrica | Meta |
|---------|------|
| Trocar provider de IA | Apenas variável de ambiente, zero código |
| Adicionar novo comando | 1 arquivo novo + 1 linha no Bootstrap |
| Testar qualquer módulo isoladamente | ✅ com mocks injetados |
| `MessageHandler` | < 30 linhas, responsabilidade única |
| Dependências circulares | Zero |
| Cobertura `core/` e `adapters/` | > 80% |

---

*Anterior: [Fase 4 — Plugin Manager](./11-fase-4-plugin-manager.md) | Início: [Visão Geral da Refatoração](./06-refatoracao-visao-geral.md)*
