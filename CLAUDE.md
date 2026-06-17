# CLAUDE.md — Guia Obrigatório para Agentes de IA

> Leia este arquivo inteiro antes de tocar em qualquer código do LumaBot.
> Ele define como você deve pensar, decidir e escrever neste projeto.

---

## O que é o LumaBot

Bot de WhatsApp com uma assistente virtual chamada **Luma** — uma IA com personalidade que se passa por uma pessoa humana no chat. Construído sobre Baileys (WhatsApp Web API) com **Arquitetura Hexagonal**, **Plugin System** e **Injeção de Dependências**.

Stack: Node.js 18+ ESM, Baileys 7.x, Google Gemini / OpenAI / DeepSeek, SQLite, Sharp, FFmpeg, Vitest. Dashboard web em Vite + React + TypeScript + Tailwind (`dashboard/web/`).

---

## Mentalidade Esperada

**Pense como um desenvolvedor sênior em JavaScript.** Cada decisão deve considerar manutenibilidade, testabilidade e extensibilidade.

- Você é responsável pela qualidade do que produz. Trate cada módulo como se milhares de usuários dependessem dele.
- Quando houver duas abordagens, escolha a que: facilita testes, reduz acoplamento, permite trocar implementações sem tocar em código consumidor.
- Siga SOLID de forma pragmática, não dogmática.
- **Não quebre funcionalidade existente.** Se não existir teste cobrindo o que você vai mexer, crie o teste antes.

---

## Convenções Absolutas (Nunca Viole)

```
Linguagem dos comentários: Português (PT-BR)
Módulos: ESM — import/export, nunca require/module.exports
Exports: Named exports apenas — nunca default export
Imports: Sempre use imports Absolutos, nunca use algo como ../config/env.js
Nomenclatura: camelCase (vars/funcs) | PascalCase (classes) | UPPER_SNAKE (constantes)
Erros: Nunca engula silenciosamente — log + rethrow ou log + fallback explícito
Documentação: Sempre que fizer alguma grande alteração, documente na pasta docs/ e adicione ao CHANGELOG.md
```

---

## Arquitetura (Hexagonal + Plugins + DI)

```
src/
├── core/
│   ├── ports/          # Contratos abstratos — AIPort, StoragePort, etc.
│   └── services/       # Lógica de domínio pura — CommandRouter, ConversationHistory, UserResolver, ReminderService, etc.
├── adapters/           # Implementações concretas dos ports
│   ├── ai/             # GeminiAdapter, OpenAIAdapter
│   ├── search/         # TavilyAdapter, GoogleGroundingAdapter
│   ├── storage/        # SQLiteStorageAdapter, InMemoryStorageAdapter
│   └── transcriber/    # GeminiTranscriberAdapter
├── plugins/            # Features como módulos plug-n-play
│   ├── PluginManager.js
│   ├── luma/           # LumaPlugin (IA/áudio/persona/stats) + RankPlugin (!rank)
│   ├── media/          # MediaPlugin — sticker, image, gif
│   ├── download/       # DownloadPlugin, AudioDownloadPlugin
│   ├── group-tools/    # GroupToolsPlugin — @everyone, etc.
│   ├── spontaneous/    # SpontaneousPlugin — interações sem trigger
│   ├── reminder/       # ReminderPlugin — !lembrete
│   ├── user/           # UserPlugin — !nick, !apelido
│   ├── resumo/         # ResumoPlugin — !resumo
│   └── utils/          # UtilsPlugin — !help, !meunumero
├── infra/
│   ├── Container.js        # DI container (lazy singleton)
│   ├── Bootstrap.js        # Wiring — instancia e conecta tudo
│   ├── BaileysSocketFactory.js  # Cria socket Baileys
│   ├── MessageRouter.js    # Roteia messages.upsert; enriquece usuários via UserResolver
│   ├── JidQueue.js         # Fila por JID (serializa mesmo chat, paraleliza distintos)
│   ├── ReminderScheduler.js # Loop de 30s que dispara lembretes vencidos
│   ├── QrCodePresenter.js  # Exibe QR no terminal e envia sinal ao dashboard
│   └── ReconnectionPolicy.js    # Decide ação após desconexão (sem executar)
├── handlers/
│   ├── MessageHandler.js   # Orquestrador fino (~40 linhas) — usa PluginManager
│   ├── LumaHandler.js      # Pipeline de IA: histórico, prompt, resposta
│   ├── MediaProcessor.js   # Download e conversão de mídia
│   ├── SpontaneousHandler.js
│   └── ToolDispatcher.js
├── managers/
│   ├── ConnectionManager.js  # Ciclo de vida do socket + reconexão
│   ├── PersonalityManager.js
│   └── GroupManager.js
├── services/           # Clientes de APIs externas (legado gradualmente migrado)
│   ├── AIService.js        # Cliente Gemini com fallback entre modelos
│   ├── AudioTranscriber.js
│   ├── Database.js
│   ├── VideoDownloader.js
│   └── WebSearchService.js
├── processors/         # Workers computacionais puros
│   ├── ImageProcessor.js
│   └── VideoConverter.js
├── config/
│   ├── env.js          # Variáveis de ambiente centralizadas — único lugar que lê process.env
│   ├── constants.js    # Constantes, comandos e mensagens da UI (aplica overrides)
│   ├── lumaConfig.js   # Personalidades, prompts, tools da IA (aplica overrides)
│   ├── ConfigStore.js  # Camada de override (data/config-overrides.json) sobre os defaults
│   ├── configSchema.js # Esquema da config editável pelo dashboard
│   └── configService.js # Leitura/gravação de config para o dashboard (env + overrides)
└── utils/              # Utilitários sem side effects
```

**Regra de dependência:** `core/` não importa nada de fora de `core/`. Adapters importam `core/ports/`. Plugins importam `core/services/` e `handlers/`. Nunca inverta essa hierarquia.

---

## Fluxo de uma Mensagem

```
WhatsApp → Baileys → MessageRouter
                          │
                   BaileysAdapter (normaliza)
                          │
                   MessageHandler.process()
                          │
                   CommandRouter.detect(text)
                          │
                   PluginManager.dispatch()
                  /                        \
       onCommand(cmd)               onMessage(todos os plugins)
            │                                    │
    Plugin responsável              LumaPlugin → LumaHandler → AIPort
    (MediaPlugin, Download...)      SpontaneousPlugin
```

---

## Padrões de Código Que Você Deve Seguir

### Injeção de Dependência

Nenhum módulo instancia suas próprias dependências com `new`. Todas entram pelo construtor.

```js
// Certo
export class LumaHandler {
  constructor({ aiService, history } = {}) {
    this.aiService = aiService ?? createAIProvider(env);
    this.history   = history   ?? new ConversationHistory();
  }
}

// Errado — acopla ao Gemini, impossível testar
export class LumaHandler {
  constructor() {
    this.ai = new AIService(process.env.GEMINI_API_KEY);
  }
}
```

### Separação de Decisão e Execução

Módulos de "política" decidem, módulos de "execução" agem. Exemplo: `ReconnectionPolicy.decide()` retorna uma string de ação — `ConnectionManager` a executa. Nunca misture os dois.

### Plugins

Cada plugin é um objeto com métodos opcionais:

```js
export class MeuPlugin {
  static commands = [COMMANDS.MEU_COMANDO];  // comandos que este plugin trata

  async onCommand(command, bot) { ... }      // quando um comando é detectado
  async onMessage(bot) { ... }               // em toda mensagem (use com parcimônia)
}
```

Para registrar: adicione em `MessageHandler.js` (`.register(new MeuPlugin())`). **Zero outras mudanças.**

---

## Testes

Framework: **Vitest**. Todos os testes ficam em `tests/unit/` espelhando a estrutura de `src/`.

```js
// Padrão obrigatório
vi.mock('../../src/servico/Qualquer.js', () => ({
  Qualquer: class {
    metodo = vi.fn().mockResolvedValue({ resultado: 'mock' });
  },
}));
```

- Use class syntax nos mocks de construtores (obrigatório no Vitest 4)
- Mocks ao nível de módulo (hoistados), nunca dentro de `it()`
- Para classes com `setInterval` (ex: `ConversationHistory`): passe `cleanupIntervalMs: 1e9` e chame `destroy()` no `afterEach`
- Testes de lógica pura não precisam de mocks — só os que tocam I/O ou rede

**Critério de qualidade:** antes de entregar qualquer mudança, rode `npx vitest run` e confirme que nenhum teste novo quebrou.

---

## O Que Você Não Deve Fazer

- **Não use `process.env` fora de `src/config/env.js`** — toda config passa por lá
- **Não adicione `default export`** em nenhum arquivo
- **Não crie helpers ou abstrações para uso único** — três linhas repetidas são melhores que uma abstração prematura
- **Não adicione comentários descrevendo o quê o código faz** — só o porquê, quando não for óbvio
- **Não engula erros com `catch {}`** vazio — pelo menos `Logger.error`
- **Não quebre o fluxo de plugins** — se adicionar uma feature nova, crie um plugin, não emende no `MessageHandler`
- **Não versione `auth_info/`, `.env`, `data/luma_private.sqlite`, `data/config-overrides.json`, `dashboard/web/node_modules/`, `dashboard/web/dist/`**
- **Persistência nova usa `DatabaseService`** (`src/services/Database.js`) — é o que está wired no fluxo vivo (o `Container`/`StoragePort` é usado em testes). Não duplique no port a menos que vá usá-lo de fato.

---

## Onde Encontrar o Quê

| Quero...                             | Arquivo                                      |
|--------------------------------------|----------------------------------------------|
| Personalidades e prompts da Luma     | `src/config/lumaConfig.js`                   |
| Comandos e mensagens de UI           | `src/config/constants.js`                    |
| Variáveis de ambiente disponíveis    | `src/config/env.js`                          |
| Lógica de reconexão do WhatsApp      | `src/infra/ReconnectionPolicy.js`            |
| Como o socket é criado               | `src/infra/BaileysSocketFactory.js`          |
| Como mensagens chegam ao MessageHandler | `src/infra/MessageRouter.js`              |
| Como adapters são wired              | `src/infra/Bootstrap.js`                     |
| Contratos dos ports de IA            | `src/core/ports/AIPort.js`                   |
| Histórico de conversa por JID        | `src/core/services/ConversationHistory.js`   |
| Construção do prompt para a IA       | `src/core/services/PromptBuilder.js`         |
| Qual provider de IA usar             | `src/core/services/AIProviderFactory.js`     |
| Formatação e split de respostas      | `src/utils/ResponseFormatter.js`             |
| Download de mídia do WhatsApp        | `src/handlers/MediaProcessor.js`             |
| Parsing de comandos                  | `src/core/services/CommandRouter.js`         |
| Resolver JID → nome humano           | `src/core/services/UserResolver.js`          |
| Agendamento/validação de lembretes   | `src/core/services/ReminderService.js`       |
| Disparo de lembretes (loop)          | `src/infra/ReminderScheduler.js`             |
| Tabelas SQLite e queries             | `src/services/Database.js`                   |
| Function calls → ações               | `src/handlers/ToolDispatcher.js`             |
| Camada de override de config         | `src/config/ConfigStore.js`                  |
| Config editável pelo dashboard       | `src/config/configSchema.js` + `configService.js` |
| Backend do dashboard / API REST      | `dashboard/server.js`                        |
| App React do dashboard               | `dashboard/web/src/`                         |

---

## Comunicação Dashboard ↔ Bot

`dashboard/server.js` (backend Express + WebSocket + API REST) gerencia o bot como processo filho. A comunicação é via `stdout` com prefixos reservados — **nunca remova esses sinais**:

| Sinal                       | Quando emitir             |
|-----------------------------|---------------------------|
| `[LUMA_QR]:rawdata\n`       | QR Code gerado            |
| `[LUMA_STATUS]:connected\n` | WhatsApp conectado        |
| `[LUMA_STATUS]:connecting\n`| Tentando conectar         |
| `[LUMA_STATUS]:disconnected\n` | Desconectado           |

O frontend é um app **React/Vite/TS** em `dashboard/web/`, buildado para `dashboard/web/dist` (servido pelo Express). Em produção roda sob o launcher (`npm run dashboard` → `dashboard/launch.js`) ou PM2 (`ecosystem.config.cjs`); o auto-deploy (`/api/deploy`) rebuilda o painel e reinicia o processo. Config editável em runtime via `/api/config` (camada de override; aplica no restart). Detalhes em `docs/06-dashboard.md`.

---

## Documentação Técnica

Leia a pasta `docs/` para entender subsistemas específicos:

- `docs/01-Arquitetura.md` — Fluxos, diagramas e design patterns
- `docs/02-nucleo-ia.md` — Como a IA funciona (prompts, histórico, tool calling)
- `docs/03-motor-midia.md` — Processamento de imagens, stickers e vídeos
- `docs/04-banco-dados.md` — Banco de dados (métricas, usuários, ranking, lembretes)
- `docs/05-conexao-wa.md` — Baileys, autenticação, reconexão, enriquecimento de usuários
- `docs/06-dashboard.md` — Dashboard React, API REST, configuração e deploy/PM2
