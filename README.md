<div align="center">

# 🤖 LumaBot v6.0

**Assistente de WhatsApp com IA multi-provider, arquitetura hexagonal e plugin system.**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/Baileys-7.x-25D366?logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Gemini AI](https://img.shields.io/badge/Gemini-2.5%20Flash-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-412991?logo=openai&logoColor=white)](https://openai.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## Visão Geral

LumaBot é um bot de WhatsApp construído sobre o Baileys com uma assistente virtual chamada **Luma** — uma IA com personalidade que se passa por uma pessoa humana no chat. A v6.0 introduz **arquitetura hexagonal completa**, **plugin system** e **suporte a múltiplos providers de IA** (Google Gemini e OpenAI), sem alterar uma linha de código de negócio para trocar de provider.

---

## Funcionalidades

### 🧠 Luma — Assistente Virtual

- **Multi-provider**: Google Gemini (padrão) ou OpenAI via variável de ambiente
- **Gemini 2.5 Flash** com fallback automático entre modelos
- **Personalidades dinâmicas** por chat (Pensadora, Pistola, Good Vibes, Sênior)
- **Visão computacional** — analisa imagens, stickers e memes
- **Tool calling** — executa ações no WhatsApp por linguagem natural
- **Transcrição de áudio** — transcreve áudios via Gemini multimodal
- **Memória de contexto** — até 80 mensagens por conversa, auto-limpeza após 2h
- **Buffer de grupo** — captura as últimas 15 mensagens do grupo e injeta no prompt
- **Busca na internet** — Tavily API com fallback para Google Search Grounding

### 🎲 Interações Espontâneas

A Luma "ganha vida" em grupos sem ser chamada:

| Tipo | Chance | Descrição |
|------|--------|-----------|
| Reagir | 35% | Reage com emoji à mensagem |
| Responder | 35% | Comenta a mensagem sem ter sido chamada |
| Puxar assunto | 30% | Inicia um assunto aleatório |

- Chance dinâmica: **4%** (grupo quieto) → **10%** (grupo ativo) → **15%** (imagem/sticker)
- Cooldown de **8 minutos** por grupo

### 🎨 Estúdio de Mídia

| Entrada | Saída | Comando |
|---------|-------|---------|
| Imagem | Sticker | `!sticker` |
| Vídeo / GIF | Sticker Animado | `!sticker` |
| Sticker | PNG | `!image` |
| Sticker Animado | GIF / MP4 | `!gif` |
| URL | Sticker | `!sticker <url>` |

### 📥 Download de Vídeos

- `!download <url>` ou `!d <url>`
- Suporte a Twitter/X e Instagram (Reels, posts, stories)
- Limite de 720p, re-encoding automático para **H.264 + faststart** (compatível com iOS)
- Binário `yt-dlp` standalone com auto-download por SO

### 🖥️ Dashboard Web

- Interface terminal com monitoramento em tempo real via **WebSocket**
- Controle do bot: ligar, desligar, reiniciar
- Stream de logs com filtro por nível (INFO / WARN / ERROR / OK) e busca por texto
- QR Code renderizado automaticamente no browser quando necessário
- Acesso remoto via **Cloudflare Tunnel** (URL pública gerada automaticamente)
- Proteção por senha via variável de ambiente

---

## Comandos

### Assistente Luma

| Gatilho | Descrição |
|---------|-----------|
| `luma, [mensagem]` | Aciona a Luma |
| `ei luma`, `oi luma` | Variações de trigger |
| Responder mensagem da Luma | Continua a conversa |
| Mensagem privada | Responde automaticamente |

### Mídia

| Comando | Descrição |
|---------|-----------|
| `!sticker` / `!s` | Imagem, vídeo ou link → sticker |
| `!image` / `!i` | Sticker → imagem PNG |
| `!gif` / `!g` | Sticker animado → GIF |
| `!download` / `!d <url>` | Baixa vídeo de rede social |

### Bot

| Comando | Descrição |
|---------|-----------|
| `!persona` | Abre menu de personalidades |
| `!luma stats` / `!ls` | Estatísticas globais |
| `!luma clear` / `!lc` | Limpa memória da conversa |
| `@everyone` / `@todos` | Menciona todos no grupo |
| `!meunumero` | Exibe seu ID e o do chat |
| `!help` / `!menu` | Lista de comandos |

---

## Instalação

### Pré-requisitos

- **Node.js** v18+
- **FFmpeg** instalado e no PATH

```bash
# Linux (Debian/Ubuntu)
sudo apt install ffmpeg -y

# Fedora
sudo dnf install ffmpeg -y

# macOS
brew install ffmpeg
```

### Setup

```bash
git clone https://github.com/murillous/LumaBot.git
cd LumaBot
npm install
```

### Configuração (`.env`)

```env
# ── Provider de IA ─────────────────────────────────────────────
# Opções: 'gemini' (padrão) | 'openai'
AI_PROVIDER=gemini

# Google Gemini — obrigatório se AI_PROVIDER=gemini
GEMINI_API_KEY=sua_chave_aqui

# OpenAI — obrigatório se AI_PROVIDER=openai
# OPENAI_API_KEY=sk-...
# AI_MODEL=gpt-4o-mini

# ── Busca na Internet ───────────────────────────────────────────
# Opcional — cai para Google Grounding se ausente
TAVILY_API_KEY=sua_chave_aqui

# ── Bot ─────────────────────────────────────────────────────────
OWNER_NUMBER=5598988776655   # opcional

# ── Dashboard ───────────────────────────────────────────────────
DASHBOARD_PORT=3000
DASHBOARD_PASSWORD=suasenha
CLOUDFLARE_TUNNEL=true
```

**Obter API Keys:**
- Gemini: [aistudio.google.com](https://aistudio.google.com/app/apikey)
- OpenAI: [platform.openai.com](https://platform.openai.com/api-keys)
- Tavily: [tavily.com](https://tavily.com)

---

## Uso

### Apenas o Bot

```bash
npm start          # produção
npm run dev        # desenvolvimento (hot-reload)
```

### Bot + Dashboard

```bash
npm run dashboard          # produção
npm run dashboard:dev      # desenvolvimento (hot-reload)
```

O dashboard sobe em `http://localhost:3000` e inicia o bot automaticamente. Com `CLOUDFLARE_TUNNEL=true`, uma URL pública é gerada e exibida no painel.

> **Cloudflared:** instale em [developers.cloudflare.com/cloudflared](https://developers.cloudflare.com/cloudflared/install) para usar o tunnel.

### Primeiros Passos

1. Suba o bot ou o dashboard
2. Escaneie o QR Code (terminal ou modal do dashboard)
3. Aguarde: **✅ Conectado com sucesso!**

---

## Arquitetura

A v6.0 implementa **Arquitetura Hexagonal (Ports & Adapters)** com **Plugin System** e **Injeção de Dependências**.

```
LumaBot/
├── index.js                          # Entry point do bot
├── dashboard/
│   └── server.js                     # Express + WebSocket + processo filho do bot
├── src/
│   ├── adapters/                     # Implementações concretas das portas
│   │   ├── ai/
│   │   │   ├── GeminiAdapter.js      # Google Gemini (padrão)
│   │   │   └── OpenAIAdapter.js      # OpenAI (GPT-4o, GPT-4o-mini)
│   │   ├── BaileysAdapter.js         # Protocolo WhatsApp → interface interna
│   │   ├── search/
│   │   │   ├── TavilyAdapter.js      # Tavily API com fallback
│   │   │   └── GoogleGroundingAdapter.js
│   │   ├── storage/
│   │   │   ├── SQLiteStorageAdapter.js   # Persistência (produção)
│   │   │   └── InMemoryStorageAdapter.js # Testes
│   │   └── transcriber/
│   │       └── GeminiTranscriberAdapter.js
│   ├── config/
│   │   ├── constants.js              # Comandos, menus e constantes da UI
│   │   ├── env.js                    # Variáveis de ambiente centralizadas
│   │   └── lumaConfig.js             # Personalidades, prompts e tools da IA
│   ├── core/                         # Domínio puro (sem dependências externas)
│   │   ├── ports/                    # Contratos abstratos (interfaces)
│   │   │   ├── AIPort.js
│   │   │   ├── MessagingPort.js
│   │   │   ├── SearchPort.js
│   │   │   ├── StoragePort.js
│   │   │   └── TranscriberPort.js
│   │   └── services/
│   │       ├── CommandRouter.js      # Parsing de texto → constante COMMANDS
│   │       └── GroupService.js       # Operações de grupo (isAdmin, mentionAll)
│   ├── handlers/                     # Pipeline de processamento de mensagens
│   │   ├── LumaHandler.js            # Orquestração da IA: histórico, prompt, resposta
│   │   ├── MediaProcessor.js         # Download e conversão de mídia
│   │   ├── MessageHandler.js         # Coordenador central → PluginManager (~40 linhas)
│   │   ├── SpontaneousHandler.js     # Interações espontâneas em grupos
│   │   └── ToolDispatcher.js         # Execução de tool calls da IA
│   ├── infra/                        # Infraestrutura (DI Container + Bootstrap)
│   │   ├── Container.js              # Injeção de dependências (lazy singleton)
│   │   └── Bootstrap.js              # Wiring de todos os adapters
│   ├── managers/
│   │   ├── ConnectionManager.js      # Conexão WhatsApp e reconexão automática
│   │   ├── GroupManager.js           # Menção, remoção de membros
│   │   └── PersonalityManager.js     # Personalidades por chat (persistidas)
│   ├── plugins/                      # Features como módulos plug-n-play
│   │   ├── PluginManager.js          # Registro e dispatch de plugins
│   │   ├── download/DownloadPlugin.js
│   │   ├── group-tools/GroupToolsPlugin.js
│   │   ├── luma/LumaPlugin.js        # IA + clear/stats/persona + onMessage
│   │   ├── media/MediaPlugin.js      # !sticker / !image / !gif
│   │   ├── spontaneous/SpontaneousPlugin.js
│   │   └── utils/UtilsPlugin.js      # !help / !meunumero
│   ├── processors/
│   │   ├── ImageProcessor.js         # Sharp: resize, compressão, sticker
│   │   └── VideoConverter.js         # FFmpeg: remux H.264 + faststart para iOS
│   ├── public/                       # Assets do dashboard
│   ├── services/
│   │   ├── AIService.js              # Cliente Gemini com fallback entre modelos
│   │   ├── AudioTranscriber.js       # Transcrição de áudio via Gemini multimodal
│   │   ├── Database.js               # SQLite (métricas + dados privados)
│   │   ├── VideoDownloader.js        # yt-dlp wrapper
│   │   └── WebSearchService.js       # Tavily + Google Search Grounding
│   └── utils/
│       ├── Exif.js                   # Metadados WebP para stickers
│       ├── FileSystem.js             # Helpers de sistema de arquivos
│       ├── Logger.js                 # Pino-based logging
│       └── MessageUtils.js           # Parsing de texto (extractUrl, getMessageType)
├── data/
│   ├── luma_metrics.sqlite           # Métricas públicas (versionado)
│   └── luma_private.sqlite           # Configurações privadas (ignorado)
├── docs/                             # Documentação da arquitetura e roadmap
├── tests/                            # 394+ testes unitários (Vitest)
└── temp/                             # Arquivos temporários
```

### Fluxo de uma Mensagem

```
WhatsApp → BaileysAdapter → MessageHandler
                                  │
                          CommandRouter.detect()
                                  │
                          PluginManager.dispatch()
                         /                       \
              onCommand(comando)            onMessage(todos plugins)
                    │                               │
            Plugin responsável              LumaPlugin → LumaHandler → AIPort
            (MediaPlugin,                  SpontaneousPlugin
             DownloadPlugin, etc.)
```

### Multi-Provider de IA

A troca de provider de IA é feita **apenas via variável de ambiente**:

```
AI_PROVIDER=gemini  →  GeminiAdapter (padrão)
AI_PROVIDER=openai  →  OpenAIAdapter
```

Nenhum código de negócio conhece qual provider está ativo. O `Bootstrap.js` resolve o adapter correto e o injeta via `Container`.

### Adicionando um Novo Plugin

1. Crie `src/plugins/meu-plugin/MeuPlugin.js`:

```js
import { COMMANDS } from '../../config/constants.js';

export class MeuPlugin {
  static commands = [COMMANDS.MEU_COMANDO];

  async onCommand(command, bot) {
    await bot.reply('Olá do novo plugin!');
  }
}
```

2. Registre em `src/handlers/MessageHandler.js`:

```js
import { MeuPlugin } from '../plugins/meu-plugin/MeuPlugin.js';
// ...
.register(new MeuPlugin())
```

**Zero alterações em qualquer outro arquivo.**

### Comunicação Dashboard ↔ Bot

O dashboard gerencia o bot como **processo filho** (`child_process.spawn`). A comunicação é via stdout com prefixos reservados:

| Sinal | Direção | Descrição |
|-------|---------|-----------|
| `[LUMA_QR]:rawdata` | bot → dashboard | QR Code para renderizar no browser |
| `[LUMA_STATUS]:connected` | bot → dashboard | WhatsApp conectado |
| `[LUMA_STATUS]:connecting` | bot → dashboard | Tentando conectar |
| `[LUMA_STATUS]:disconnected` | bot → dashboard | Desconectado |

---

## Tecnologias

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| [Node.js](https://nodejs.org/) | 18+ | Runtime |
| [Baileys](https://github.com/WhiskeySockets/Baileys) | 7.x | WhatsApp Web API |
| [Google Gemini AI](https://ai.google.dev/) | 2.5 Flash | IA multimodal + tool calling |
| [OpenAI](https://openai.com/) | GPT-4o | Provider alternativo de IA |
| [Express](https://expressjs.com/) | 5.x | Servidor HTTP do dashboard |
| [ws](https://github.com/websockets/ws) | 8.x | WebSocket (tempo real) |
| [Sharp](https://sharp.pixelplumbing.com/) | 0.32 | Processamento de imagens |
| [FFmpeg](https://ffmpeg.org/) | — | Processamento de vídeos |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 12.x | Banco de dados local |
| [Vitest](https://vitest.dev/) | 3.x | Suite de testes (394+ testes) |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | latest | Download de vídeos sociais |
| [cloudflared](https://developers.cloudflare.com/cloudflared/) | — | Tunnel para URL pública |

---

## Configurações Avançadas

### Trocar Provider de IA

```env
# Usar OpenAI
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
AI_MODEL=gpt-4o-mini   # ou gpt-4o para respostas melhores
```

### Personalizar Stickers

`src/config/constants.js`:
```js
export const STICKER_METADATA = {
  PACK_NAME: "LumaBot 🤖",
  AUTHOR: "Criado com ❤️ por LumaBot",
};
```

### Criar Nova Personalidade

`src/config/lumaConfig.js`:
```js
PERSONALITIES: {
  minha_persona: {
    name: "Nome da Persona",
    description: "Aparece no menu (!persona)",
    context: "Você é uma IA que...",
    style: "Estilo de escrita",
    traits: ["traço 1", "traço 2"],
  }
}
```

### Ajustar Interações Espontâneas

`src/config/lumaConfig.js` → `SPONTANEOUS`:
```js
chance: 0.04,           // 4% grupo quieto
imageChance: 0.15,      // 15% quando tem imagem
cooldownMs: 8 * 60000,  // 8 minutos entre interações
```

---

## Troubleshooting

**Luma não responde**
- Verifique se a API Key do provider ativo está no `.env`
- Mensagem precisa conter "luma" ou ser no privado

**Sticker / GIF não converte**
- Confirme FFmpeg instalado: `ffmpeg -version`
- Responda à mídia antes de usar o comando

**Bot não conecta**
- Delete a pasta `auth_info` e escaneie o QR novamente
- Verifique conexão com a internet

**Dashboard inacessível**
- Confirme que `npm run dashboard` está rodando
- Verifique a porta em `DASHBOARD_PORT` (padrão: 3000)

**Download falha**
- `yt-dlp` é baixado automaticamente na primeira execução
- Conteúdo privado não pode ser baixado

---

## Licença

MIT — veja [LICENSE](LICENSE).

---

<div align="center">

Desenvolvido por **Murilo Castelhano**

[⭐ Star](https://github.com/murillous/LumaBot) · [🐛 Bug](https://github.com/murillous/LumaBot/issues) · [💡 Feature](https://github.com/murillous/LumaBot/issues)

</div>
