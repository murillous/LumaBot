# Fase 1 — Ports & Adapters

> **Status:** 🔜 Próxima  
> **Branch:** `feat/phase-1-ports-adapters`  
> **Base:** `develop` (merge da Fase 0 primeiro)  
> **Objetivo:** Definir as interfaces (portas) do domínio e criar os primeiros adaptadores formalizados, desacoplando o código de negócio de tecnologias concretas

---

## O problema que esta fase resolve

Hoje, o `LumaHandler` sabe que usa Gemini. O `MessageHandler` sabe que usa Baileys. Se você quiser trocar o provider de IA ou a library WhatsApp, precisa reescrever ~70-80% do código de negócio.

A Fase 1 introduz uma camada de **contrato** entre o domínio e as tecnologias:

```
Antes:  LumaHandler → GoogleGenAI (diretamente)
Depois: LumaHandler → AIPort (interface) ← GeminiAdapter (implementação)
```

---

## Estrutura a criar

```
src/
├── core/
│   └── ports/
│       ├── AIPort.js          # Interface para providers de IA
│       ├── MessagingPort.js   # Interface para adapters WhatsApp
│       ├── StoragePort.js     # Interface para bancos de dados
│       ├── SearchPort.js      # Interface para busca na internet
│       └── TranscriberPort.js # Interface para transcrição de áudio
│
└── adapters/
    ├── ai/
    │   └── GeminiAdapter.js       # Implementa AIPort usando @google/genai
    ├── messaging/
    │   └── BaileysAdapter.js      # Já existe — refatorar para implementar MessagingPort
    ├── search/
    │   ├── TavilyAdapter.js       # Extrai de WebSearchService
    │   └── GoogleGroundingAdapter.js
    └── transcriber/
        └── GeminiTranscriberAdapter.js  # Extrai de AudioTranscriber
```

---

## Portas a definir

### `AIPort` — Contrato de IA

```js
/**
 * @interface AIPort
 * Contrato para qualquer provider de IA generativa.
 */
export class AIPort {
  /**
   * Gera uma resposta textual com base no histórico de conversa.
   * @param {Array<{role: string, parts: Array}>} history
   * @param {string} systemPrompt
   * @param {Array} tools - Tool definitions (opcional)
   * @returns {Promise<{text: string, functionCalls: Array}>}
   */
  async generateContent(history, systemPrompt, tools = []) {
    throw new Error('AIPort.generateContent() não implementado');
  }

  /**
   * Processa conteúdo multimodal (imagem, áudio, vídeo).
   * @param {string} prompt
   * @param {Array<{mimeType: string, data: Buffer}>} media
   * @returns {Promise<string>}
   */
  async processMedia(prompt, media) {
    throw new Error('AIPort.processMedia() não implementado');
  }

  /**
   * Retorna estatísticas de uso (tokens, chamadas).
   * @returns {object}
   */
  getStats() {
    throw new Error('AIPort.getStats() não implementado');
  }
}
```

### `MessagingPort` — Contrato de Mensageria

```js
/**
 * @interface MessagingPort
 * Contrato para qualquer plataforma de mensagens.
 */
export class MessagingPort {
  /** Envia texto simples */
  async sendText(jid, text, options = {}) { throw new Error('não implementado'); }

  /** Envia imagem com legenda */
  async sendImage(jid, imageBuffer, caption = '') { throw new Error('não implementado'); }

  /** Envia áudio */
  async sendAudio(jid, audioBuffer) { throw new Error('não implementado'); }

  /** Reage a uma mensagem */
  async react(jid, messageKey, emoji) { throw new Error('não implementado'); }

  /** Retorna ID do bot conectado */
  getBotJid() { throw new Error('não implementado'); }
}
```

### `StoragePort` — Contrato de Persistência

```js
/**
 * @interface StoragePort
 * Contrato para qualquer camada de armazenamento.
 */
export class StoragePort {
  async getConversationHistory(jid) { throw new Error('não implementado'); }
  async saveMessage(jid, role, content) { throw new Error('não implementado'); }
  async clearHistory(jid) { throw new Error('não implementado'); }
  async getPersonality(jid) { throw new Error('não implementado'); }
  async setPersonality(jid, personality) { throw new Error('não implementado'); }
  async logMetric(event, data) { throw new Error('não implementado'); }
}
```

### `SearchPort` — Contrato de Busca

```js
/**
 * @interface SearchPort
 * Contrato para qualquer serviço de busca na internet.
 */
export class SearchPort {
  /**
   * @param {string} query
   * @returns {Promise<string>} Resultados formatados como texto
   */
  async search(query) { throw new Error('não implementado'); }
}
```

### `TranscriberPort` — Contrato de Transcrição

```js
/**
 * @interface TranscriberPort
 */
export class TranscriberPort {
  /**
   * @param {Buffer} audioBuffer
   * @param {string} mimeType
   * @returns {Promise<string|null>}
   */
  async transcribe(audioBuffer, mimeType) { throw new Error('não implementado'); }
}
```

---

## Adaptadores a criar/refatorar

### `GeminiAdapter` — Implementação de `AIPort`

Extrai a lógica de chamada ao Gemini que hoje está embutida em `AIService.js` e `LumaHandler.js`:

```js
import { AIPort } from '../../core/ports/AIPort.js';
import { GoogleGenAI } from '@google/genai';

export class GeminiAdapter extends AIPort {
  constructor({ apiKey, model }) {
    super();
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateContent(history, systemPrompt, tools = []) {
    // lógica migrada de AIService.generateContent()
  }

  async processMedia(prompt, media) {
    // lógica migrada de AIService.processMedia()
  }

  getStats() {
    return this.stats;
  }
}
```

### `BaileysAdapter` (refatoração)

O `BaileysAdapter` atual faz duas coisas: desempacota mensagens recebidas E envia mensagens. Separar em:

1. **`BaileysMessageAdapter`** — desempacota mensagens recebidas (já testado na Fase 0)
2. **`BaileysMessagingAdapter`** — implementa `MessagingPort` para envio

---

## Testes a criar nesta fase

| Arquivo | O que testa |
|---------|-------------|
| `tests/unit/adapters/GeminiAdapter.test.js` | Mapeamento de parâmetros, tratamento de erros, stats |
| `tests/unit/adapters/TavilyAdapter.test.js` | Formatação, quota detection, HTTP errors |
| `tests/unit/adapters/GoogleGroundingAdapter.test.js` | Fallback behavior |
| `tests/unit/core/ports/*.test.js` | Portas lançam erro quando métodos não implementados |
| `tests/integration/AIPort.test.js` | GeminiAdapter satisfaz o contrato de AIPort |

---

## Critérios de saída

- [ ] 5 portas definidas em `src/core/ports/`
- [ ] `GeminiAdapter` implementando `AIPort` e cobrindo `AIService` existente
- [ ] `BaileysAdapter` refatorado para implementar `MessagingPort`
- [ ] `TavilyAdapter` e `GoogleGroundingAdapter` implementando `SearchPort`
- [ ] `GeminiTranscriberAdapter` implementando `TranscriberPort`
- [ ] Todos os testes da Fase 0 ainda passando
- [ ] Novos testes unitários para cada adaptador
- [ ] Testes de contrato para cada porta

---

*Anterior: [Fase 0 — Fundação de Testes](./07-fase-0-testes.md) | Próxima: [Fase 2 — Container de DI](./09-fase-2-container-di.md)*
