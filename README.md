<div align="center">

# LumaBot

Assistente de IA para WhatsApp com personalidade humana, arquitetura hexagonal, plugin system e suporte a múltiplos providers de IA.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/Baileys-7.x-25D366?logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Gemini AI](https://img.shields.io/badge/Gemini-2.5%20Flash-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 📌 Visão Geral

LumaBot é um bot de WhatsApp com uma assistente virtual chamada **Luma** — uma IA com personalidade que se passa por uma pessoa humana no chat. O sistema responde mensagens, analisa imagens, transcreve áudios, busca na internet, processa mídia e interage espontaneamente em grupos.

O projeto foi construído com foco em **manutenibilidade e extensibilidade**: adicionar uma nova feature significa criar um plugin isolado, sem tocar no core do sistema. Trocar o provider de IA é uma variável de ambiente.

---

## 🏗 Arquitetura

O sistema implementa **Arquitetura Hexagonal (Ports & Adapters)** com **Plugin System** e **Injeção de Dependências**.

```
Core (domínio puro)
 └── Ports → contratos abstratos (AIPort, StoragePort, MessagingPort...)
 └── Services → lógica de domínio (ConversationHistory, PromptBuilder, CommandRouter...)

Adapters (implementações concretas dos ports)
 └── ai/         → GeminiAdapter, OpenAIAdapter
 └── search/     → TavilyAdapter, GoogleGroundingAdapter
 └── storage/    → SQLiteStorageAdapter, InMemoryStorageAdapter
 └── transcriber → GeminiTranscriberAdapter

Plugins (features como módulos plug-n-play)
 └── LumaPlugin, MediaPlugin, DownloadPlugin, GroupToolsPlugin, SpontaneousPlugin...

Infra (wiring e infraestrutura)
 └── Container, Bootstrap, BaileysSocketFactory, MessageRouter, ReconnectionPolicy...

Handlers (pipeline de mensagens)
 └── MessageHandler → LumaHandler → ToolDispatcher
```

**Regra de dependência:** `core/` não importa nada externo. Adapters implementam ports. Plugins consomem services e handlers. Nunca inverta essa hierarquia.

**Separação de decisão e execução:** `ReconnectionPolicy` decide a ação de reconexão retornando uma string — `ConnectionManager` a executa. Nenhum dos dois conhece a lógica do outro.

Para detalhes completos: [`docs/01-Arquitetura.md`](./docs/01-Arquitetura.md)

---

## 🛠 Stack Tecnológica

| Tecnologia | Versão | Uso |
|---|---|---|
| **Node.js** | 18+ | Runtime ESM nativo |
| **Baileys** | 7.x | WhatsApp Web API (engenharia reversa do protocolo) |
| **Google Gemini** | 2.5 Flash | Provider de IA padrão — multimodal + tool calling |
| **OpenAI / DeepSeek** | — | Providers alternativos, troca via `AI_PROVIDER` |
| **Sharp** | 0.32+ | Processamento de imagem (stickers WebP 512×512) |
| **FFmpeg** | qualquer | Processamento de vídeo e stickers animados |
| **yt-dlp** | — | Download de vídeos de redes sociais |
| **better-sqlite3** | 12+ | SQLite síncrono para métricas e personalidades |
| **pino** | 10+ | Logger estruturado de alta performance |
| **Vitest** | 4.x | Suite de testes unitários (510+ testes) |

---

## 📁 Estrutura do Projeto

```bash
LumaBot/
├── index.js                    # Entry point do bot
├── dashboard/
│   └── server.js               # Dashboard web (Express + WebSocket)
├── src/
│   ├── core/
│   │   ├── ports/              # Contratos abstratos (AIPort, StoragePort...)
│   │   └── services/           # Lógica de domínio pura
│   ├── adapters/
│   │   ├── ai/                 # GeminiAdapter, OpenAIAdapter
│   │   ├── search/             # TavilyAdapter, GoogleGroundingAdapter
│   │   ├── storage/            # SQLiteStorageAdapter, InMemoryStorageAdapter
│   │   └── transcriber/        # GeminiTranscriberAdapter
│   ├── plugins/                # Features como módulos plug-n-play
│   │   ├── luma/               # LumaPlugin — IA, áudio, persona, stats
│   │   ├── media/              # MediaPlugin — sticker, image, gif
│   │   ├── download/           # DownloadPlugin, AudioDownloadPlugin
│   │   ├── group-tools/        # GroupToolsPlugin — @everyone, etc.
│   │   ├── spontaneous/        # SpontaneousPlugin — interações sem trigger
│   │   ├── resumo/             # ResumoPlugin
│   │   └── utils/              # UtilsPlugin — !help, !meunumero
│   ├── infra/
│   │   ├── Container.js        # DI container (lazy singleton)
│   │   ├── Bootstrap.js        # Wiring — instancia e conecta tudo
│   │   ├── BaileysSocketFactory.js
│   │   ├── MessageRouter.js    # Roteia messages.upsert → MessageHandler via JidQueue
│   │   ├── JidQueue.js         # Fila por JID — serializa mesmo chat, paraleliza chats distintos
│   │   ├── QrCodePresenter.js
│   │   └── ReconnectionPolicy.js
│   ├── handlers/
│   │   ├── MessageHandler.js   # Orquestrador (~40 linhas) — usa PluginManager
│   │   ├── LumaHandler.js      # Pipeline de IA: histórico, prompt, resposta
│   │   ├── MediaProcessor.js
│   │   ├── SpontaneousHandler.js
│   │   └── ToolDispatcher.js
│   ├── managers/
│   │   ├── ConnectionManager.js
│   │   ├── PersonalityManager.js
│   │   └── GroupManager.js
│   ├── services/               # Clientes de APIs externas
│   ├── processors/             # Workers computacionais puros (Sharp, FFmpeg)
│   ├── config/
│   │   ├── env.js              # Único lugar que lê process.env
│   │   ├── constants.js        # Comandos e mensagens de UI
│   │   └── lumaConfig.js       # Personalidades, prompt templates, tools
│   └── utils/                  # Helpers sem side effects
├── tests/
│   └── unit/                   # Espelha src/, Vitest
├── docs/                       # Documentação técnica detalhada
├── data/                       # SQLite (luma_metrics.sqlite)
├── auth_info/                  # Credenciais Baileys — NÃO versionar
└── .env                        # Variáveis de ambiente — NÃO versionar
```

---

## ⚙️ Pré-requisitos

- **Node.js** >= 18
- **FFmpeg** no PATH

```bash
# Debian/Ubuntu
sudo apt install ffmpeg -y

# Fedora
sudo dnf install ffmpeg -y

# macOS
brew install ffmpeg

# Windows
choco install ffmpeg
```

---

## 🔐 Configuração do Ambiente

### Instalação

```bash
git clone https://github.com/murillous/LumaBot.git
cd LumaBot
npm install
```

### Variáveis de Ambiente

Copie `.env.example` e preencha:

```bash
cp .env.example .env
```

```env
# Provider de IA — gemini (padrão) | openai | deepseek
AI_PROVIDER=gemini

# Modelo específico (opcional — cada provider tem seu padrão)
# AI_MODEL=gemini-2.5-flash

# API Keys — apenas a do provider ativo é obrigatória
GEMINI_API_KEY=            # obrigatória se AI_PROVIDER=gemini
# OPENAI_API_KEY=          # obrigatória se AI_PROVIDER=openai
# DEEPSEEK_API_KEY=        # obrigatória se AI_PROVIDER=deepseek

# Busca na web (opcional)
# Sem esta chave, Gemini usa Google Grounding como fallback.
# Com OpenAI/DeepSeek sem esta chave, busca web fica indisponível.
# TAVILY_API_KEY=

# Bot
# OWNER_NUMBER=5511999999999   # número do dono para permissões especiais
# LOG_LEVEL=silent              # silent | error | warn | info | debug

# Dashboard web (opcional)
# DASHBOARD_PORT=3000
# DASHBOARD_PASSWORD=           # deixe vazio para desabilitar autenticação
# CLOUDFLARE_TUNNEL=false       # true se estiver atrás de tunnel Cloudflare
```

**Onde obter as chaves:**
- Gemini: [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- DeepSeek: [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
- Tavily: [tavily.com](https://tavily.com)

---

## ▶️ Execução

```bash
# Só o bot (terminal)
npm start

# Bot com hot-reload (desenvolvimento)
npm run dev

# Bot + Dashboard web
npm run dashboard

# Dashboard com hot-reload
npm run dashboard:dev
```

**Primeiro acesso:**
1. Rode o bot
2. Escaneie o QR Code que aparece no terminal (ou em `http://localhost:3000` com o dashboard)
3. Aguarde a confirmação de conexão — as credenciais são salvas em `auth_info/`

---

## 🧠 Fluxo Interno

```
WhatsApp → Baileys → MessageRouter (JidQueue)
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

**Contexto em grupos:** cada pessoa tem seu próprio histórico de conversa com a Luma (`historyKey = groupJid:senderJid`). As últimas 15 mensagens do grupo são injetadas no prompt como contexto coletivo, sem misturar com o histórico individual.

**Providers de IA:** `AIProviderFactory` seleciona o adapter via `AI_PROVIDER`. `LumaHandler` recebe o provider por injeção de dependência — não sabe qual é. Gemini suporta fallback automático entre modelos (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`).

**Tool calling:** a Luma pode executar ações via function calling da API (`tag_everyone`, `remove_member`, `create_sticker`, `search_web`, `clear_history`, `show_help`). O `ToolDispatcher` mapeia cada função ao plugin responsável.

---

## 🧩 Como Adicionar um Plugin

```js
// src/plugins/meu-plugin/MeuPlugin.js
export class MeuPlugin {
  static commands = [COMMANDS.MEU_COMANDO];

  async onCommand(command, bot) { /* trata o comando */ }
  async onMessage(bot) { /* escuta toda mensagem — use com moderação */ }
}
```

Registrar em `src/handlers/MessageHandler.js`:

```js
.register(new MeuPlugin())
```

Zero outras mudanças. O plugin recebe o `bot` (BaileysAdapter) com todos os métodos de envio e leitura.

---

## 🧪 Qualidade e Testes

```bash
# Suite completa
npm test

# Watch mode (desenvolvimento)
npm run test:watch

# Com cobertura
npm run test:coverage
```

**Convenções:**
- Testes ficam em `tests/unit/` espelhando `src/`
- Use class syntax nos mocks de construtores (obrigatório no Vitest 4)
- Mocks no nível de módulo (hoistados), nunca dentro de `it()`
- Para classes com `setInterval` (ex: `ConversationHistory`): passe `cleanupIntervalMs: 1e9` e chame `destroy()` no `afterEach`

---

## 📈 Observabilidade

**Logs:** pino com saída estruturada. Nível configurável via `LOG_LEVEL`.

**Métricas:** gravadas em SQLite (`data/luma_metrics.sqlite`) a cada interação — respostas de IA, stickers criados, vídeos baixados. Visíveis via `!luma stats` no chat ou no dashboard web.

**Dashboard web:** `http://localhost:3000` — logs em tempo real, status de conexão, QR Code, controles de liga/desliga/reinício.

**Sinais de status para o dashboard** (via stdout — não remova):

| Sinal | Quando |
|---|---|
| `[LUMA_QR]:rawdata` | QR Code gerado |
| `[LUMA_STATUS]:connected` | WhatsApp conectado |
| `[LUMA_STATUS]:connecting` | Tentando conectar |
| `[LUMA_STATUS]:disconnected` | Desconectado |

---

## 🚀 Deploy

O bot roda como processo Node.js simples. Recomendações para produção:

- **PM2** ou **systemd** para supervisão do processo
- **Cloudflare Tunnel** para acesso externo ao dashboard sem abrir portas (`CLOUDFLARE_TUNNEL=true`)
- Mantenha `auth_info/` e `.env` fora do controle de versão (`.gitignore` já configurado)
- `data/luma_metrics.sqlite` pode ser versionado — contém apenas contadores agregados, sem conteúdo de mensagens

---

## 🔄 Scripts Disponíveis

| Script | O que faz |
|---|---|
| `npm start` | Bot em produção |
| `npm run dev` | Bot com hot-reload |
| `npm run dashboard` | Bot + Dashboard web |
| `npm run dashboard:dev` | Dashboard com hot-reload |
| `npm test` | Suite completa de testes |
| `npm run test:watch` | Testes em watch mode |
| `npm run test:coverage` | Testes com relatório de cobertura |

---

## 📌 Decisões Técnicas

| Decisão | Razão |
|---|---|
| Arquitetura Hexagonal | Troca de provider de IA ou banco sem tocar no domínio |
| Plugin System | Adicionar features sem modificar o core — só criar e registrar |
| `historyKey = groupJid:senderJid` | Cada pessoa tem contexto isolado em grupos; elimina cruzamento de histórico |
| `JidQueue` por JID | Mensagens do mesmo chat são serializadas; chats diferentes processam em paralelo |
| `better-sqlite3` síncrono | Sem latência de rede; adequado para dados locais de métricas |
| Separação de Decisão/Execução | `ReconnectionPolicy` é testável sem simular socket real |
| ESM nativo | Sem transpilação; `import/export` em todo o projeto |

---

## 🤝 Contribuição

```bash
git checkout -b feature/nova-feature
# implemente e adicione testes
npm test
git commit -m "feat: descrição da mudança"
git push origin feature/nova-feature
```

Pull Requests devem conter:
- Contexto e motivação
- Testes cobrindo o novo comportamento
- Nenhum `default export` (convenção do projeto)
- Comentários apenas quando o **porquê** não for óbvio

Leia [`CLAUDE.md`](./CLAUDE.md) antes de contribuir — contém as convenções obrigatórias do projeto.

---

## 📚 Documentação Técnica

| Doc | Conteúdo |
|---|---|
| [`docs/01-Arquitetura.md`](./docs/01-Arquitetura.md) | Pipeline, camadas, design patterns, fluxos detalhados |
| [`docs/02-nucleo-ia.md`](./docs/02-nucleo-ia.md) | Prompts, memória, tool calling, busca web, espontaneidade |
| [`docs/03-motor-midia.md`](./docs/03-motor-midia.md) | Sharp, FFmpeg, stickers, downloads |
| [`docs/04-banco-dados.md`](./docs/04-banco-dados.md) | Estratégia híbrida SQLite |
| [`docs/05-conexao-wa.md`](./docs/05-conexao-wa.md) | Baileys, autenticação, reconexão |
| [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) | Histórico de versões |

---

## 📄 Licença

MIT — veja [LICENSE](LICENSE).

---

<div align="center">

Desenvolvido por **Murilo Castelhano**

[⭐ Star](https://github.com/murillous/LumaBot) · [🐛 Bug](https://github.com/murillous/LumaBot/issues) · [💡 Feature](https://github.com/murillous/LumaBot/issues)

</div>
