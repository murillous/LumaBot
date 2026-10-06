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

LumaBot é um bot de WhatsApp com uma assistente virtual chamada **Luma** — uma IA com personalidade que se passa por uma pessoa humana no chat. O sistema responde mensagens, analisa imagens, transcreve áudios, busca na internet, processa mídia, agenda lembretes, mantém ranking de interações e interage espontaneamente em grupos.

O projeto foi construído com foco em **manutenibilidade e extensibilidade**: adicionar uma nova feature significa criar um plugin isolado, sem tocar no core do sistema. Trocar o provider de IA é uma variável de ambiente. Acompanha um **dashboard web** (Vite + React + TypeScript) que controla o bot e configura **tudo** que vive em `src/config` sem editar código.

**Destaques desta versão (7.0):**
- 👤 **UserResolver** — resolve JID → nome humano de forma robusta (`@lid` inclusive), com apelidos manuais
- 🏆 **Ranking** de quem mais interage com a Luma (global e por grupo)
- ⏰ **Lembretes** por comando ou linguagem natural ("Luma, me lembre… terça às 16h"), com menção a uma ou várias pessoas — sobrevivem a reinícios
- 🎛 **Dashboard novo** em React, mobile-first, que edita toda a configuração em runtime
- 🚀 **Auto-deploy** que aplica backend e painel em todo push na `main`

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
| **better-sqlite3** | 12+ | SQLite síncrono para métricas, personalidades, usuários, ranking e lembretes |
| **pino** | 10+ | Logger estruturado de alta performance |
| **Vitest** | 4.x | Suite de testes unitários (556 testes) |
| **Vite + React + TS** | 5.x / 18.x | Dashboard web (SPA) |
| **Tailwind CSS** | 3.x | Estilização do dashboard (tema Thera) |
| **PM2** | opcional | Supervisão em produção (autorestart + boot) |

---

## 📁 Estrutura do Projeto

```bash
LumaBot/
├── index.js                    # Entry point do bot
├── ecosystem.config.cjs        # Config PM2 (produção)
├── dashboard/
│   ├── server.js               # Backend do dashboard (Express + WebSocket + API REST)
│   ├── launch.js               # Supervisor mínimo (reinicia o server no deploy/crash)
│   └── web/                    # App React (Vite + TS + Tailwind) — buildado em web/dist
│       └── src/
│           ├── components/     # AppShell + primitivos de UI
│           ├── pages/          # Overview, Logs, Config, Social, Reminders, Login
│           └── lib/            # api, useLive (WebSocket), tipos, utils
├── src/
│   ├── core/
│   │   ├── ports/              # Contratos abstratos (AIPort, StoragePort...)
│   │   └── services/           # Lógica de domínio pura
│   │       ├── UserResolver.js     # JID → melhor nome humano
│   │       ├── ReminderService.js  # Validação e persistência de lembretes
│   │       └── ...                 # CommandRouter, ConversationHistory, PromptBuilder...
│   ├── adapters/
│   │   ├── ai/                 # GeminiAdapter, OpenAIAdapter
│   │   ├── search/             # TavilyAdapter, GoogleGroundingAdapter
│   │   ├── storage/            # SQLiteStorageAdapter, InMemoryStorageAdapter
│   │   └── transcriber/        # GeminiTranscriberAdapter
│   ├── plugins/                # Features como módulos plug-n-play
│   │   ├── luma/               # LumaPlugin (IA/persona/stats) + RankPlugin (!rank)
│   │   ├── media/              # MediaPlugin — sticker, image, gif
│   │   ├── download/           # DownloadPlugin, AudioDownloadPlugin
│   │   ├── group-tools/        # GroupToolsPlugin — @everyone, etc.
│   │   ├── spontaneous/        # SpontaneousPlugin — interações sem trigger
│   │   ├── reminder/           # ReminderPlugin — !lembrete
│   │   ├── user/               # UserPlugin — !nick, !apelido
│   │   ├── resumo/             # ResumoPlugin
│   │   └── utils/              # UtilsPlugin — !help, !meunumero
│   ├── infra/
│   │   ├── Container.js        # DI container (lazy singleton)
│   │   ├── Bootstrap.js        # Wiring — instancia e conecta tudo
│   │   ├── BaileysSocketFactory.js
│   │   ├── MessageRouter.js    # Roteia messages.upsert; enriquece usuários (UserResolver)
│   │   ├── JidQueue.js         # Fila por JID — serializa mesmo chat, paraleliza chats distintos
│   │   ├── ReminderScheduler.js # Loop que dispara lembretes vencidos
│   │   ├── QrCodePresenter.js
│   │   └── ReconnectionPolicy.js
│   ├── handlers/
│   │   ├── MessageHandler.js   # Orquestrador — usa PluginManager
│   │   ├── LumaHandler.js      # Pipeline de IA: histórico, prompt, resposta
│   │   ├── MediaProcessor.js
│   │   ├── SpontaneousHandler.js
│   │   └── ToolDispatcher.js   # Mapeia function calls → ações (inclui schedule_reminder)
│   ├── managers/
│   │   ├── ConnectionManager.js  # Ciclo do socket + listeners de contatos + scheduler
│   │   ├── PersonalityManager.js
│   │   └── GroupManager.js
│   ├── services/               # Clientes de APIs externas + Database.js (SQLite)
│   ├── processors/             # Workers computacionais puros (Sharp, FFmpeg)
│   ├── config/
│   │   ├── env.js              # Único lugar que lê process.env
│   │   ├── constants.js        # Comandos e mensagens de UI (aplica overrides)
│   │   ├── lumaConfig.js       # Personalidades, prompt templates, tools (aplica overrides)
│   │   ├── ConfigStore.js      # Camada de override (data/config-overrides.json)
│   │   ├── configSchema.js     # Esquema da config editável pelo dashboard
│   │   └── configService.js    # Leitura/gravação de config para o dashboard
│   └── utils/                  # Helpers sem side effects
├── tests/
│   └── unit/                   # Espelha src/, Vitest (556 testes)
├── docs/                       # Documentação técnica detalhada
├── data/                       # SQLite (luma_metrics.sqlite versionado; privado e overrides NÃO)
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

# Bot + Dashboard web (build a primeira vez; depois é só rodar)
npm run dashboard:build   # builda dashboard/web/dist (uma vez, ou quando o front mudar)
npm run dashboard         # sobe o launcher → dashboard + bot

# Dashboard React em modo dev (hot-reload, proxy para a API em :3000)
npm run dashboard:web:dev
```

> O `npm run dashboard` usa o launcher (`dashboard/launch.js`), que reinicia o
> processo automaticamente no auto-deploy e em caso de crash. O backend do
> dashboard serve o build de `dashboard/web/dist`; se o build não existir, cai
> no dashboard legado em `src/public`.

**Primeiro acesso:**
1. Rode o bot (ou o dashboard)
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

**Tool calling:** a Luma pode executar ações via function calling da API (`tag_everyone`, `remove_member`, `create_sticker`, `create_image`, `create_gif`, `search_web`, `clear_history`, `show_help`, `schedule_reminder`). O `ToolDispatcher` mapeia cada função à ação responsável.

**Identidade de usuário:** o `UserResolver` mantém um perfil por JID em `wa_users` (enriquecido por mensagens, eventos de contato e menções) e escolhe o melhor nome na exibição — apelido manual → pushName → notify → contato → verificado → fallback `@últimos6`. Usado por ranking, lembretes e logs.

**Ranking:** cada interação real com a Luma incrementa um contador por `(grupo, pessoa)` em `luma_interactions`. `!rank` mostra o ranking do grupo; `!rank global`, o agregado.

**Lembretes:** persistidos em `reminders` e disparados pelo `ReminderScheduler` (loop de 30s) — sobrevivem a reinícios. A IA calcula a data/hora absoluta (ISO 8601, fuso de Brasília) e o `schedule_reminder` valida e agenda; também há o comando manual `!lembrete`.

---

## 💬 Comandos

| Comando | Função |
|---|---|
| `Luma ...` | Fala com a IA (trigger por nome, reply ou em PV) |
| `!persona` | Menu de personalidades (responda `p1`, `p2`...) |
| `!luma clear` (`!lc`, `!clear`) | Limpa a memória da sua conversa |
| `!luma stats` (`!ls`) | Estatísticas globais da Luma |
| `!sticker` (`!s`) · `!image` (`!i`) · `!gif` (`!g`) | Conversões de mídia |
| `!download` (`!d`) · `!audio` (`!a`) | Baixa vídeo / áudio (yt-dlp) |
| `!resumo [n]` | Resume as últimas mensagens |
| `@everyone` / `@todos` | Marca todos do grupo |
| `!rank` · `!rank global` | Ranking de interações com a Luma |
| `!nick <nome>` | Define seu apelido na exibição |
| `!apelido @fulano <nome>` | Define o apelido de alguém |
| `!lembrete DD/MM/AAAA HH:mm \| texto` | Agenda lembrete (ou peça à Luma em linguagem natural) |
| `!meunumero` · `!help` | Seu ID/número · lista de comandos |

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

O dashboard é o processo principal em produção: ele sobe o servidor web e
spawna o bot (`index.js`) como processo filho.

### Produção com PM2 (sobrevive a reboot)

```bash
npm install -g pm2
git pull && npm install && npm run dashboard:build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # rode o comando sudo que ele imprimir
```

A Luma volta sozinha após reboot da máquina e após crash. No auto-deploy, o
`server.js` sai com código 0 e o PM2 respawna com o código novo.

### Auto-deploy por push na `main`

Configure no `.env` o `DEPLOY_WEBHOOK_SECRET` e aponte um webhook do GitHub
(push) para `POST /api/deploy`. A cada push na `main`:

```
git pull → npm install (se mudou) → build do dashboard → restart supervisionado
```

Assim **backend e dashboard são aplicados sem tocar no servidor**. Sob PM2 (ou
sob o launcher `npm run dashboard`), o processo se reinicia sozinho; sem
supervisor, apenas o backend reinicia e um aviso é logado.

### Uso local (só testar)

```bash
npm install
npm run dashboard:build   # uma vez
npm run dashboard         # http://localhost:3000
```

O launcher reinicia em caso de crash. Não sobrevive a reboot (use PM2 para isso).

### Boas práticas

- **Cloudflare Tunnel** para acesso externo ao dashboard sem abrir portas (`CLOUDFLARE_TUNNEL=true`)
- Mantenha `auth_info/`, `.env` e `data/config-overrides.json` fora do controle de versão (`.gitignore` já configurado)
- `data/luma_metrics.sqlite` pode ser versionado — contém apenas contadores agregados, sem conteúdo de mensagens
- O `data/luma_private.sqlite` (personalidades, usuários, ranking, lembretes) **nunca** é versionado

---

## 🔄 Scripts Disponíveis

| Script | O que faz |
|---|---|
| `npm start` | Bot em produção (sem dashboard) |
| `npm run dev` | Bot com hot-reload |
| `npm run dashboard` | Bot + Dashboard web (via launcher, auto-restart) |
| `npm run dashboard:dev` | Backend do dashboard com hot-reload (nodemon) |
| `npm run dashboard:web:dev` | App React em modo dev (Vite, hot-reload) |
| `npm run dashboard:build` | Instala deps e builda o app React em `dashboard/web/dist` |
| `npm run pm2:start` | Sobe sob PM2 (`ecosystem.config.cjs`) |
| `npm run pm2:restart` | Reinicia o processo `luma` no PM2 |
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
| [`docs/04-banco-dados.md`](./docs/04-banco-dados.md) | SQLite — métricas, usuários, ranking, lembretes |
| [`docs/05-conexao-wa.md`](./docs/05-conexao-wa.md) | Baileys, autenticação, reconexão, enriquecimento de usuários |
| [`docs/06-dashboard.md`](./docs/06-dashboard.md) | Dashboard React, API REST, configuração, deploy/PM2 |
| [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) | Histórico de versões |

---

## 📄 Licença

MIT — veja [LICENSE](LICENSE).

---

<div align="center">

Desenvolvido por **Murilo Castelhano**

[⭐ Star](https://github.com/murillous/LumaBot) · [🐛 Bug](https://github.com/murillous/LumaBot/issues) · [💡 Feature](https://github.com/murillous/LumaBot/issues)

</div>
