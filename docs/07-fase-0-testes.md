# Fase 0 — Fundação de Testes + Config Centralizada

> **Status:** ✅ Concluída  
> **Branch:** `feat/phase-0-test-foundation`  
> **Objetivo:** Criar uma rede de segurança de testes e centralizar configuração de variáveis de ambiente antes de qualquer refatoração estrutural

---

## Por que esta fase existe?

Toda refatoração sem testes é um salto de fé. A Fase 0 estabelece a **linha de base comportamental** do sistema atual — não para provar que o código está correto, mas para garantir que qualquer mudança futura não quebre comportamentos existentes silenciosamente.

Além disso, `process.env` estava espalhado em 7 arquivos diferentes. Um bug de variável faltante só aparecia em runtime, sem mensagem clara. A centralização resolve isso.

---

## O que foi implementado

### 0.1 — Setup do Vitest

**Arquivo:** `vitest.config.js`

```js
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/public/**', 'src/config/**'],
      thresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
    },
  },
});
```

**Dependências adicionadas** ao `package.json`:
- `vitest@^4.1.4` — test runner nativo para ESM
- `@vitest/coverage-v8@^4.1.4` — cobertura via V8 (sem instrumentação manual)

**Scripts disponíveis:**
```bash
npm test              # roda todos os testes uma vez
npm run test:watch    # modo watch (re-executa em mudanças)
npm run test:coverage # gera relatório de cobertura
```

**Por que Vitest e não Jest?** O projeto usa `"type": "module"` no `package.json` (ESM puro). O Jest requer configuração complexa de transformers para ESM. O Vitest suporta ESM nativamente, zero config.

---

### 0.2 — Testes de Caracterização (164 testes)

Testes de caracterização documentam o **comportamento atual** do código — são um espelho, não um juízo. Se um comportamento for incorreto, o teste captura isso para que a decisão de mudá-lo seja consciente.

#### `tests/unit/BaileysAdapter.test.js` (36 testes)

Cobre o adaptador que desempacota mensagens do Baileys:

| Categoria | O que testa |
|-----------|-------------|
| `unwrapMessage` | Mensagens diretas, quoted, viewOnce, documentWithCaption |
| Getters de corpo | `body`, `caption`, `textContent`, `lowerBody` |
| Detecção de mídia | `isImage`, `isVideo`, `isAudio`, `isSticker`, `isDocument`, `isViewOnce` |
| Quoted messages | `quotedMessage`, `quotedBody`, `quotedMimetype` |
| Métodos de envio | `reply`, `sendText`, `sendImage`, `react` |

#### `tests/unit/MessageHandler.test.js` (34 testes)

Cobre os métodos estáticos do handler principal:

| Categoria | O que testa |
|-----------|-------------|
| `detectCommand` | 19 comandos + aliases (`!s`, `!sticker`, `!clear`, `!lc`…) |
| `extractUrl` | URLs de vídeo em mensagens, ausência de URL |
| `getMessageType` | Tipos: texto, imagem, vídeo, áudio, documento, sticker |

> **Bug descoberto pelos testes:** `!lc` (alias de `!clear`) estava definido nas constantes e no switch case de execução, mas nunca era detectado em `detectCommand()` — tornando o comando silenciosamente inoperante. Corrigido nesta fase.

#### `tests/unit/LumaHandler.test.js` (32 testes)

Cobre a lógica de orquestração da assistente IA:

| Categoria | O que testa |
|-----------|-------------|
| `isTriggered` | Menção direta, resposta a mensagem da Luma, grupos vs privado |
| `extractUserMessage` | Remoção de prefixos (`@luma`, `luma,`, `luma:`) |
| `splitIntoParts` | Separador `[PARTE]`, fallback para mensagem única |
| Gestão de histórico | Adição, limite máximo, limpeza |

#### `tests/unit/PersonalityManager.test.js` (10 testes)

| Categoria | O que testa |
|-----------|-------------|
| `getActivePersonality` | Retorno de personalidade, fallback para padrão |
| `setPersonality` | Persistência no banco, validação de nome |
| `listPersonalities` | Enumeração de todas as personalidades |

#### `tests/unit/SpontaneousHandler.test.js` (14 testes)

| Categoria | O que testa |
|-----------|-------------|
| Configuração | Pesos de probabilidade somam corretamente |
| Guard de grupo | Só dispara em grupos, nunca em privado |
| Estrutura de prompts | Cada tipo de interação tem prompt definido |

#### `tests/unit/VideoDownloader.test.js` (10 testes)

| Categoria | O que testa |
|-----------|-------------|
| `detectVideoUrl` | Twitter/X, Instagram (reel, /p/, /tv/) |
| Limpeza de URL | Remoção de query params |
| Não-suporte | URLs não reconhecidas retornam `null` |

#### `tests/unit/AudioTranscriber.test.js` (14 testes)

| Categoria | O que testa |
|-----------|-------------|
| `normalizeMimeType` | Todos os tipos MIME, `null`, case-insensitive |
| `transcribe` | Chave `null` lança erro, todos falham retorna `null`, sucesso, retry |
| `_extractText` | Extração de texto de partes da resposta Gemini |

#### `tests/unit/WebSearchService.test.js` (14 testes)

| Categoria | O que testa |
|-----------|-------------|
| `_formatTavilyResults` | Formatação com e sem `answer`, múltiplos resultados |
| `_isQuotaError` | Detecção de 429, "quota", "limit" |
| Roteamento de busca | Tavily → grounding → ativação de fallback por 429 |

---

### 0.3 — Config Centralizada (`src/config/env.js`)

**Antes:** `process.env.GEMINI_API_KEY` aparecia em 7 arquivos. Sem validação. Erros silenciosos em runtime.

**Depois:** Um único ponto de validação e acesso.

```js
// src/config/env.js
dotenv.config();

const REQUIRED = ['GEMINI_API_KEY'];

function validateRequired() {
  const missing = REQUIRED.filter(key => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`[Config] Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  }
}

validateRequired(); // executa ao importar — falha rápida e clara no boot

export const env = Object.freeze({
  GEMINI_API_KEY:      process.env.GEMINI_API_KEY,
  TAVILY_API_KEY:      process.env.TAVILY_API_KEY || undefined,
  LOG_LEVEL:           process.env.LOG_LEVEL || 'silent',
  DASHBOARD_PORT:      parseInt(process.env.DASHBOARD_PORT || '3000', 10),
  DASHBOARD_PASSWORD:  process.env.DASHBOARD_PASSWORD || '',
  CLOUDFLARE_TUNNEL:   process.env.CLOUDFLARE_TUNNEL === 'true',
});
```

**`Object.freeze()`** impede mutações acidentais de `env` em runtime.

**Arquivos migrados** (removido `dotenv.config()` e `process.env.*` substituídos por `env.*`):
- `src/handlers/MessageHandler.js`
- `src/handlers/LumaHandler.js`
- `src/services/WebSearchService.js`
- `src/managers/ConnectionManager.js`
- `index.js` — agora importa `env.js` apenas para disparar a validação no boot

---

## Bugs corrigidos nesta fase

### Bug: `!lc` não funcionava

**Sintoma:** Usuários que digitavam `!lc` (alias de `!limpar`) não tinham o histórico apagado.

**Causa raiz:** `COMMANDS.LUMA_CLEAR_SHORT = "!lc"` estava definido em constantes e tratado no `switch` de execução, mas `detectCommand()` nunca verificava esse alias — retornava `null`.

**Correção** em `src/handlers/MessageHandler.js`:
```js
// Em detectCommand(), antes da verificação de !clear:
if (lower === COMMANDS.LUMA_CLEAR_SHORT) return COMMANDS.LUMA_CLEAR;
```

**Como foi encontrado:** O teste de caracterização para `detectCommand` cobriu todos os aliases listados nas constantes — o teste falhou porque `!lc` retornava `null` em vez de `COMMANDS.LUMA_CLEAR`. Clássico exemplo de como testes revelam bugs existentes antes de qualquer refatoração.

---

## Decisões técnicas

### Por que usar `class {}` em vez de `vi.fn()` para mocks de construtores?

O Vitest 4 emite avisos (e em alguns casos falha) quando um mock de construtor não é uma função com `prototype`. A sintaxe `class` garante compatibilidade:

```js
// ❌ Problemático no Vitest 4
vi.mock('./AIService.js', () => ({
  AIService: vi.fn().mockImplementation(() => ({ generateContent: vi.fn() })),
}));

// ✅ Correto
vi.mock('./AIService.js', () => ({
  AIService: class {
    generateContent = vi.fn().mockResolvedValue({ text: 'mock', functionCalls: [] });
  },
}));
```

### Por que variáveis de módulo para reconfiguraer mocks por teste?

Para mocks de classe onde cada teste precisa de um comportamento diferente, usamos uma variável de módulo que o `vi.mock` captura por closure:

```js
let mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: (...args) => mockGenerateContent(...args) };
    }
  },
}));

beforeEach(() => {
  mockGenerateContent = vi.fn(); // reconfigura sem re-hoisting
});
```

---

## Critérios de saída (todos atendidos)

- [x] Vitest instalado e configurado
- [x] 164 testes passando
- [x] Cobertura > 60% nos módulos testados
- [x] `env.js` centralizado com validação no boot
- [x] Zero chamadas a `process.env` fora de `env.js` nos arquivos migrados
- [x] Bug `!lc` corrigido

---

## Próxima fase

**[Fase 1 — Ports & Adapters](./08-fase-1-ports-adapters.md)**: Definir as interfaces (portas) do domínio e criar os primeiros adaptadores formalizados, eliminando dependências diretas de Gemini e Baileys no código de negócio.
