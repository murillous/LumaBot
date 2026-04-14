# Fase 2 — Container de DI + Bootstrap

> **Status:** ⏳ Planejada  
> **Branch:** `feat/phase-2-di-container`  
> **Base:** `develop` (merge da Fase 1 primeiro)  
> **Objetivo:** Eliminar `new` hardcoded nos módulos de negócio, introduzindo um container de injeção de dependência e um bootstrap centralizado

---

## O problema que esta fase resolve

Mesmo com as portas definidas na Fase 1, os módulos ainda instanciam suas dependências internamente:

```js
// Hoje em LumaHandler — amarrado ao Gemini e ao SQLite
class LumaHandler {
  constructor() {
    this.ai = new AIService(process.env.GEMINI_API_KEY); // ← hardcoded
    this.db = new DatabaseService();                      // ← hardcoded
  }
}
```

Isso impede:
- **Testes unitários reais**: não há como injetar um mock sem monkeypatch de módulo
- **Troca de provider**: mudar para OpenAI exige editar o código de negócio
- **Múltiplas instâncias**: impossível ter contextos isolados

---

## O que é injeção de dependência?

Em vez de cada módulo criar suas dependências, um **container** central cria e conecta tudo:

```js
// Com DI — LumaHandler não sabe o que está recebendo, só sabe que satisfaz o contrato
class ChatService {
  constructor({ aiPort, storagePort, messagingPort }) {
    this.ai = aiPort;       // qualquer AIPort
    this.storage = storagePort;
    this.messaging = messagingPort;
  }
}
```

O container é responsável por resolver qual implementação vai para cada porta.

---

## Estrutura a criar

```
src/
└── infra/
    ├── Container.js   # Registry de dependências + resolução
    └── Bootstrap.js   # Wiring: instancia e conecta tudo com as env vars corretas
```

---

## `Container.js` — Design

Um container simples sem magic framework:

```js
export class Container {
  #registry = new Map();
  #singletons = new Map();

  /**
   * Registra uma factory para um token.
   * @param {string} token - Identificador da dependência
   * @param {Function} factory - Função que retorna a instância
   * @param {object} options
   * @param {boolean} options.singleton - Se true, reutiliza a instância (padrão: true)
   */
  register(token, factory, { singleton = true } = {}) {
    this.#registry.set(token, { factory, singleton });
    return this; // fluent API
  }

  /**
   * Resolve uma dependência pelo token.
   * @param {string} token
   * @returns {*} A instância resolvida
   */
  resolve(token) {
    const entry = this.#registry.get(token);
    if (!entry) throw new Error(`[Container] Token não registrado: "${token}"`);

    if (entry.singleton) {
      if (!this.#singletons.has(token)) {
        this.#singletons.set(token, entry.factory(this));
      }
      return this.#singletons.get(token);
    }

    return entry.factory(this);
  }

  /** Atalho para resolve — permite desestruturar no construtor */
  get(token) {
    return this.resolve(token);
  }
}
```

---

## `Bootstrap.js` — Wiring completo

```js
import { Container } from './Container.js';
import { env } from '../config/env.js';

// Adapters
import { GeminiAdapter } from '../adapters/ai/GeminiAdapter.js';
import { BaileysMessagingAdapter } from '../adapters/messaging/BaileysMessagingAdapter.js';
import { SQLiteStorageAdapter } from '../adapters/storage/SQLiteStorageAdapter.js';
import { InMemoryStorageAdapter } from '../adapters/storage/InMemoryStorageAdapter.js';
import { TavilyAdapter } from '../adapters/search/TavilyAdapter.js';
import { GoogleGroundingAdapter } from '../adapters/search/GoogleGroundingAdapter.js';
import { GeminiTranscriberAdapter } from '../adapters/transcriber/GeminiTranscriberAdapter.js';

// Services (core)
import { ChatService } from '../core/services/ChatService.js';
import { MediaService } from '../core/services/MediaService.js';

export function createContainer(sock) {
  const c = new Container();

  // --- Adapters de infraestrutura ---
  c.register('aiPort', () => new GeminiAdapter({
    apiKey: env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
  }));

  c.register('messagingPort', () => new BaileysMessagingAdapter(sock));

  c.register('storagePort', () => new SQLiteStorageAdapter());

  c.register('searchPort', (container) => {
    // Se Tavily estiver disponível, usa como primário com grounding como fallback
    if (env.TAVILY_API_KEY) {
      return new TavilyAdapter({
        apiKey: env.TAVILY_API_KEY,
        fallback: new GoogleGroundingAdapter({ aiPort: container.get('aiPort') }),
      });
    }
    return new GoogleGroundingAdapter({ aiPort: container.get('aiPort') });
  });

  c.register('transcriberPort', (container) => new GeminiTranscriberAdapter({
    aiPort: container.get('aiPort'),
  }));

  // --- Serviços de domínio ---
  c.register('chatService', (container) => new ChatService({
    aiPort: container.get('aiPort'),
    storagePort: container.get('storagePort'),
    messagingPort: container.get('messagingPort'),
    searchPort: container.get('searchPort'),
  }));

  c.register('mediaService', (container) => new MediaService({
    transcriberPort: container.get('transcriberPort'),
    messagingPort: container.get('messagingPort'),
  }));

  return c;
}
```

### Uso em `ConnectionManager`:

```js
// Antes (Fase 0)
await MessageHandler.process(botAdapter);

// Depois (Fase 2)
const container = createContainer(this.sock);
const chatService = container.get('chatService');
await chatService.handle(botAdapter);
```

---

## `InMemoryStorageAdapter` — Para testes

Um adaptador de armazenamento em memória permite testar os serviços de domínio sem banco de dados real:

```js
export class InMemoryStorageAdapter extends StoragePort {
  #store = new Map();

  async getConversationHistory(jid) {
    return this.#store.get(`history:${jid}`) ?? [];
  }

  async saveMessage(jid, role, content) {
    const key = `history:${jid}`;
    const history = this.#store.get(key) ?? [];
    history.push({ role, content, timestamp: Date.now() });
    this.#store.set(key, history);
  }

  async clearHistory(jid) {
    this.#store.delete(`history:${jid}`);
  }

  // ... demais métodos
}
```

---

## Testes a criar nesta fase

| Arquivo | O que testa |
|---------|-------------|
| `tests/unit/infra/Container.test.js` | `register`, `resolve`, singleton, token inválido |
| `tests/unit/adapters/SQLiteStorageAdapter.test.js` | CRUD de histórico, personalidade, métricas |
| `tests/unit/adapters/InMemoryStorageAdapter.test.js` | Mesmo contrato, em memória |
| `tests/integration/ChatService.test.js` | ChatService com GeminiAdapter mock + InMemoryStorageAdapter |
| `tests/integration/Bootstrap.test.js` | `createContainer` resolve sem erros, tokens esperados existem |

---

## Critérios de saída

- [ ] `Container.js` com register/resolve/singleton funcionando
- [ ] `Bootstrap.js` conectando todos os adapters e serviços
- [ ] `InMemoryStorageAdapter` implementando `StoragePort` (para testes)
- [ ] `ConnectionManager` usando o container em vez de `new MessageHandler`
- [ ] Testes unitários do `Container`
- [ ] Testes de integração do `ChatService` usando adapters em memória
- [ ] Todos os testes da Fase 0 ainda passando

---

*Anterior: [Fase 1 — Ports & Adapters](./08-fase-1-ports-adapters.md) | Próxima: [Fase 3 — Decomposição dos Handlers](./10-fase-3-decomposicao.md)*
