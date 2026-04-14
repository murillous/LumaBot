# 🏗️ Refatoração Arquitetural — Visão Geral

> **Status:** Em andamento  
> **Branch base:** `develop`  
> **Objetivo:** Migrar o LumaBot de um monolito com alto acoplamento para um **Monolito Modular com Arquitetura Hexagonal**

---

## Por que refatorar?

O LumaBot cresceu rapidamente e acumulou dívida técnica. O diagnóstico do estado atual revelou problemas que tornam o projeto difícil de manter e impossível de testar de forma confiável:

| Problema | Onde | Consequência |
|----------|------|--------------|
| **God Class** | `MessageHandler.js` (659 linhas, 7+ responsabilidades) | Qualquer mudança arrisca quebrar funcionalidades não relacionadas |
| **Dependência circular** | `MessageHandler` ↔ `MediaProcessor` | Fragilidade no carregamento de módulos |
| **Zero injeção de dependência** | Todo o projeto | Impossível testar isoladamente, impossível trocar implementações |
| **IA acoplada ao Gemini** | `AIService`, `AudioTranscriber`, `WebSearchService` | Trocar de provider exigiria reescrever ~70% do código |
| **Messaging acoplado ao Baileys** | `ConnectionManager`, `BaileysAdapter`, `MediaProcessor` | Trocar de library WhatsApp: ~80% de reescrita |
| **Métodos estáticos em tudo** | `MessageHandler`, `MediaProcessor`, `GroupManager` | Estado global implícito, sem testabilidade |
| **Sem testes** | 0 testes no projeto pré-refatoração | Qualquer refatoração era um salto de fé |

---

## Arquitetura Alvo

```
src/
├── core/                    # Domínio puro — zero dependências externas
│   ├── ports/               # Interfaces (contratos): AIPort, MessagingPort...
│   ├── domain/              # Entidades: Message, Conversation, Personality
│   └── services/            # Casos de uso: ChatService, MediaService...
│
├── adapters/                # Implementações concretas dos ports
│   ├── ai/                  # GeminiAdapter, OpenAIAdapter (futuro)
│   ├── messaging/           # BaileysAdapter (já existe, será refatorado)
│   ├── storage/             # SQLiteAdapter, InMemoryAdapter (para testes)
│   ├── search/              # TavilyAdapter, GoogleGroundingAdapter
│   ├── media/               # SharpAdapter, FFmpegAdapter, YtDlpAdapter
│   └── transcriber/         # GeminiTranscriberAdapter
│
├── plugins/                 # Features modulares plug-n-play
│   ├── PluginManager.js     # Registro e ciclo de vida de plugins
│   ├── sticker/             # Plugin de stickers
│   ├── download/            # Plugin de download de vídeos
│   ├── luma/                # Plugin da assistente IA
│   ├── group-tools/         # Plugin de ferramentas de grupo
│   └── spontaneous/         # Plugin de interações espontâneas
│
├── config/
│   ├── env.js               # ✅ Config centralizada (implementado na Fase 0)
│   ├── constants.js         # Constantes do sistema
│   ├── personalities.js     # Personalidades (a extrair de lumaConfig.js)
│   └── prompts.js           # Templates de prompt (a extrair)
│
└── infra/
    ├── Container.js         # Container de injeção de dependência
    └── Bootstrap.js         # Wiring: instancia e conecta tudo
```

---

## Fases do Projeto

| Fase | Nome | Branch | Status |
|------|------|--------|--------|
| [Fase 0](./07-fase-0-testes.md) | Fundação de Testes + Config | `feat/phase-0-test-foundation` | ✅ Concluída |
| [Fase 1](./08-fase-1-ports-adapters.md) | Ports & Adapters | `feat/phase-1-ports-adapters` | 🔜 Próxima |
| [Fase 2](./09-fase-2-container-di.md) | Container de DI + Bootstrap | `feat/phase-2-di-container` | ⏳ Planejada |
| [Fase 3](./10-fase-3-decomposicao.md) | Decomposição dos Handlers | `feat/phase-3-decompose-handlers` | ⏳ Planejada |
| [Fase 4](./11-fase-4-plugin-manager.md) | Plugin Manager | `feat/phase-4-plugin-manager` | ⏳ Planejada |
| [Fase 5](./12-fase-5-multi-ia.md) | Multi-Provider de IA | `feat/phase-5-multi-ai-provider` | ⏳ Planejada |
| Fase 6 | Testes completos + Docs | `feat/phase-6-tests-docs` | ⏳ Planejada |

---

## Princípios Que Guiam a Refatoração

### 1. Portas e Adaptadores (Hexagonal)

O código de domínio nunca depende de tecnologia concreta. Ele depende de **portas** (interfaces), e as **tecnologias concretas** (Gemini, Baileys, SQLite) entram como **adaptadores** injetados.

```
Domínio fala com → AIPort (interface)
GeminiAdapter   → implementa AIPort
OpenAIAdapter   → implementa AIPort  ← trocar provider: zero mudança no domínio
```

### 2. Injeção de Dependência

Nenhum módulo instancia suas próprias dependências com `new`. Todas as dependências entram pelo construtor.

```js
// ❌ Antes (acoplado)
class LumaHandler {
  constructor() {
    this.ai = new AIService(process.env.GEMINI_API_KEY); // amarrado ao Gemini
  }
}

// ✅ Depois (injetado)
class ChatService {
  constructor({ aiPort, storagePort, messagingPort }) {
    this.ai = aiPort;         // qualquer provider que implemente AIPort
    this.storage = storagePort;
    this.messaging = messagingPort;
  }
}
```

### 3. Plugin Manager (Plug-n-Play)

Cada feature é um módulo auto-contido que declara seus comandos e hooks. Adicionar, remover ou desabilitar uma feature não requer tocar em código existente.

### 4. Testes Primeiro

Nenhuma fase de refatoração começa sem testes de caracterização do comportamento atual. O critério de saída de cada fase inclui que todos os testes passem.

---

## Métricas de Sucesso (Critérios de Conclusão)

Quando a refatoração estiver completa, o projeto deve atender a:

- **Trocar provider de IA** alterando uma variável de ambiente (zero código)
- **Adicionar novo comando** criando um plugin sem tocar em código existente
- **Testar qualquer módulo** isoladamente com mocks injetados
- **`MessageHandler`** com menos de 150 linhas e responsabilidade única
- **Zero dependências circulares** entre módulos
- **80%+ cobertura** no `core/` e `adapters/`

---

*Veja o [ARCHITECTURE_ROADMAP.md](../ARCHITECTURE_ROADMAP.md) na raiz do projeto para o planejamento completo com checklists.*
