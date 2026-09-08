# Documentação Técnica — LumaBot

Base de conhecimento do LumaBot v7.0. Implementa **Arquitetura Hexagonal (Ports & Adapters)** com **Plugin System** e **Injeção de Dependências**, com dashboard web em React.

> Antes de qualquer coisa, leia o [`CLAUDE.md`](../CLAUDE.md) na raiz do projeto — ele contém as convenções obrigatórias, a arquitetura em mapa e o que você não deve fazer.

---

## Trilha de Leitura

| # | Doc | O que você aprende |
|---|-----|--------------------|
| 1 | [Arquitetura & Fluxos](./01-Arquitetura.md) | Pipeline de mensagens, camadas (core/adapters/plugins/infra), design patterns, fluxos detalhados por cenário |
| 2 | [Núcleo de IA](./02-nucleo-ia.md) | Como a Luma monta prompts, gerencia memória e usa tool calling |
| 3 | [Motor de Mídia](./03-motor-midia.md) | Processamento de imagens (Sharp), stickers, vídeos (FFmpeg) e downloads |
| 4 | [Banco de Dados](./04-banco-dados.md) | SQLite — métricas públicas, usuários, ranking e lembretes |
| 5 | [Conexão WhatsApp](./05-conexao-wa.md) | Baileys, autenticação via QR, reconexão, enriquecimento de usuários |
| 6 | [Dashboard](./06-dashboard.md) | App React, API REST, configuração em runtime e deploy/PM2 |
| 10 | [Versionamento](./10-versionamento.md) | SemVer, CHANGELOG, workflow de release |

---

## Stack Tecnológica

| Tecnologia | Uso |
|------------|-----|
| **Node.js 18+** | Runtime com ESM nativo |
| **Baileys 7.x** | WhatsApp Web API (engenharia reversa do protocolo) |
| **Google Gemini** | IA multimodal + tool calling (provider padrão) |
| **OpenAI / DeepSeek** | Providers alternativos — troca via `AI_PROVIDER` no `.env` |
| **Sharp** | Processamento de imagem 5× mais rápido que Canvas/Jimp |
| **FFmpeg** | Processamento de vídeo — stickers animados, remux H.264 |
| **yt-dlp** | Download de vídeos de redes sociais |
| **better-sqlite3** | SQLite síncrono — métricas, usuários, ranking, lembretes |
| **Vitest** | Suite de testes unitários (556 testes) |
| **pino** | Logger estruturado de alta performance |
| **Vite + React + TS + Tailwind** | Dashboard web (SPA) em `dashboard/web/` |
| **PM2** | Supervisão opcional em produção (autorestart + boot) |

---

## Estrutura de Diretórios

```
lumabot/
├── CLAUDE.md               ← leia antes de qualquer coisa
├── index.js                ← entry point do bot
├── ecosystem.config.cjs    ← config PM2 (produção)
├── dashboard/
│   ├── server.js           ← Express + WebSocket + API REST + processo filho do bot
│   ├── launch.js           ← supervisor mínimo (auto-restart no deploy/crash)
│   └── web/                ← app React (Vite + TS + Tailwind), build em web/dist
├── src/
│   ├── core/               ← domínio puro (UserResolver, ReminderService, ...)
│   ├── adapters/           ← implementações concretas dos ports
│   ├── plugins/            ← features plug-n-play (luma, user, reminder, ...)
│   ├── infra/              ← wiring, MessageRouter, JidQueue, ReminderScheduler
│   ├── handlers/           ← pipeline de mensagens + ToolDispatcher
│   ├── managers/           ← estado persistente (conexão, personalidade)
│   ├── services/           ← clientes de APIs externas + Database.js (SQLite)
│   ├── processors/         ← workers computacionais puros (imagem, vídeo)
│   ├── config/             ← env, constants, lumaConfig, ConfigStore, configSchema
│   └── utils/              ← helpers sem side effects
├── tests/unit/             ← espelha src/, Vitest (556 testes)
├── docs/                   ← esta documentação
└── data/                   ← SQLite (luma_metrics.sqlite versionado; privado/overrides NÃO)
```

---

## Quick Reference

### Onde fica cada coisa

| Quero mexer em... | Arquivo |
|-------------------|---------|
| Personalidades e prompts | `src/config/lumaConfig.js` |
| Comandos e mensagens de UI | `src/config/constants.js` |
| Variáveis de ambiente | `src/config/env.js` |
| Adicionar um comando novo | Crie um plugin em `src/plugins/` e registre em `MessageHandler.js` |
| Trocar o provider de IA | Variável `AI_PROVIDER` no `.env` |
| Lógica de reconexão | `src/infra/ReconnectionPolicy.js` |
| Como o prompt é montado | `src/core/services/PromptBuilder.js` |
| Histórico de conversa | `src/core/services/ConversationHistory.js` |
| Resolver JID → nome | `src/core/services/UserResolver.js` |
| Lembretes (lógica/loop) | `src/core/services/ReminderService.js` · `src/infra/ReminderScheduler.js` |
| Tabelas SQLite | `src/services/Database.js` |
| Config editável pelo painel | `src/config/configSchema.js` · `configService.js` |
| Dashboard (back/front) | `dashboard/server.js` · `dashboard/web/src/` |

### Comandos

```bash
npm start              # bot em produção
npm run dev            # bot com hot-reload
npm run dashboard:build # builda o dashboard React (uma vez)
npm run dashboard      # bot + dashboard web (via launcher)
npm run dashboard:web:dev # front do dashboard em modo dev (Vite)
npm test               # suite completa de testes
npm run test:coverage  # cobertura de testes
```
