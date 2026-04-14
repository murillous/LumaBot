# 📘 Documentação Técnica - LumaBot

Bem-vindo à base de conhecimento do LumaBot. Esta documentação foi escrita para transformar desenvolvedores iniciantes em contribuidores ativos do projeto.

O LumaBot não é apenas um script; é uma aplicação estruturada seguindo princípios de **Clean Code**, **Separação de Responsabilidades** e **Arquitetura Orientada a Eventos**.

## 🚀 Começando por aqui

Se você quer entender como o projeto funciona "por baixo do capô", siga esta trilha:

1. [**Arquitetura & Fluxos**](./01-Arquitetura.md): Entenda o caminho que uma mensagem percorre desde o celular do usuário até a resposta do servidor. Contém diagramas visuais.
2. [**O Cérebro (IA)**](./02-nucleo-ia.md): Descubra como gerenciamos memória, personalidades e a API do Google Gemini.
3. [**Engenharia de Mídia**](./03-motor-midia.md): Uma aula sobre manipulação de imagens, stickers e vídeos com FFmpeg.
4. [**Persistência de Dados**](./04-banco-dados.md): Entenda nossa estratégia híbrida de bancos de dados para privacidade e métricas.
5. [**Núcleo WhatsApp**](./05-conexao-wa.md): Detalhes sobre a biblioteca Baileys e gestão de sockets.

---

## 🏗️ Refatoração Arquitetural

O LumaBot está passando por uma migração de monolito acoplado para **Monolito Modular com Arquitetura Hexagonal**. Acompanhe o progresso:

6. [**Visão Geral da Refatoração**](./06-refatoracao-visao-geral.md): Diagnóstico dos problemas atuais, arquitetura alvo e roadmap de fases.

### Fases

| # | Fase | Doc | Status |
|---|------|-----|--------|
| 0 | Fundação de Testes + Config | [07-fase-0-testes.md](./07-fase-0-testes.md) | ✅ Concluída |
| 1 | Ports & Adapters | [08-fase-1-ports-adapters.md](./08-fase-1-ports-adapters.md) | 🔜 Próxima |
| 2 | Container de DI + Bootstrap | [09-fase-2-container-di.md](./09-fase-2-container-di.md) | ⏳ Planejada |
| 3 | Decomposição dos Handlers | [10-fase-3-decomposicao.md](./10-fase-3-decomposicao.md) | ⏳ Planejada |
| 4 | Plugin Manager | [11-fase-4-plugin-manager.md](./11-fase-4-plugin-manager.md) | ⏳ Planejada |
| 5 | Multi-Provider de IA | [12-fase-5-multi-ia.md](./12-fase-5-multi-ia.md) | ⏳ Planejada |

## 🛠️ Stack Tecnológica Detalhada

| Tecnologia | Função | Por que escolhemos? |
|------------|--------|---------------------|
| **Node.js** | Runtime | Assincronicidade nativa (I/O non-blocking) ideal para chatbots. |
| **Baileys** | API WhatsApp | Emula o WebSocket do WhatsApp Web. Grátis e não requer Selenium/Puppeteer. |
| **Better-SQLite3** | Banco de Dados | Acesso síncrono ultra-rápido, sem latência de rede, ideal para configurações locais. |
| **Google GenAI** | Inteligência | O modelo Gemini Flash é o melhor custo-benefício (grátis e multimodal) atual. |
| **Sharp** | Imagens | Processamento de imagem 5x mais rápido que Canvas/Jimp. |
| **FFmpeg** | Vídeo | O "canivete suíço" do processamento de vídeo. Indispensável para stickers animados. |

## 📚 Estrutura de Diretórios

```
lumabot/
├── src/
│   ├── adapters/       # Adaptadores de protocolo
│   ├── handlers/       # Controladores de eventos
│   ├── processors/     # Workers de processamento
│   ├── managers/       # Gerenciadores de estado
│   └── services/       # Camada de dados
├── config/             # Configurações
├── auth_info/          # Credenciais WhatsApp (NÃO versionar)
├── data/               # Bancos de dados
└── docs/               # Esta documentação
```

## 🎯 Filosofia do Projeto

### Princípios de Design

1. **Separação de Responsabilidades**: Cada módulo tem uma única função bem definida.
2. **Facilidade de Teste**: Componentes isolados são fáceis de testar.
3. **Escalabilidade**: Arquitetura preparada para crescer sem refatoração completa.
4. **Documentação Viva**: O código é auto-explicativo, mas a documentação aprofunda o "porquê".

### O que NÃO é o LumaBot

- ❌ Um bot pronto para vender/comercializar sem modificações
- ❌ Uma solução plug-and-play sem necessidade de entender o código
- ❌ Um projeto "mágico" onde tudo funciona sem conhecimento técnico

### O que É o LumaBot

- ✅ Uma base sólida para criar seu próprio bot personalizado
- ✅ Um projeto educacional sobre arquitetura de software
- ✅ Uma implementação limpa de integração WhatsApp + IA
- ✅ Um exemplo de boas práticas em Node.js

## 🔧 Requisitos de Sistema

### Obrigatórios
- Node.js >= 18.x
- NPM ou Yarn
- FFmpeg instalado no sistema
- 2GB RAM mínimo
- 500MB espaço em disco

### Opcionais
- Git (para versionamento)
- PM2 (para produção)
- Linux/macOS (recomendado para produção)

## 🚦 Quick Start

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/lumabot.git
cd lumabot

# Instale as dependências
npm install

# Configure suas credenciais
cp .env.example .env
nano .env  # Adicione sua GEMINI_API_KEY

# Inicie o bot
npm start
```

Na primeira execução, um QR Code aparecerá no terminal. Escaneie com seu WhatsApp.

## 🤝 Contribuindo

Leia cada arquivo de documentação antes de contribuir. Entender a arquitetura é essencial para manter a consistência do código.

### Checklist para Pull Requests

- [ ] Segui o padrão de nomenclatura dos arquivos existentes
- [ ] Adicionei comentários explicativos em lógicas complexas
- [ ] Testei em ambiente local antes de commitar
- [ ] Atualizei a documentação se necessário
- [ ] Não comitei arquivos sensíveis (`auth_info/`, `.env`)

## 📖 Glossário Rápido

- **JID**: Jabber ID, identificador único de usuários/grupos no WhatsApp
- **Socket**: Conexão WebSocket mantida com os servidores do WhatsApp
- **Baileys**: Biblioteca que implementa o protocolo do WhatsApp Web
- **BaileysAdapter**: Adaptador que normaliza e desempacota mensagens do Baileys
- **Gemini**: Modelo de IA do Google usado para conversação e tool calling
- **Sticker**: Figurinha do WhatsApp (formato WebP específico)
- **Handler**: Módulo que recebe e processa eventos
- **ToolDispatcher**: Despachante de ferramentas acionadas pela IA
- **SpontaneousHandler**: Módulo que dispara interações da Luma em grupos sem ser chamada
- **Processor**: Módulo que executa tarefas computacionais
- **Tool Calling**: Mecanismo onde a IA aciona funções reais do bot
- **Tavily**: Serviço de busca na internet usado como provedor principal pelo WebSearchService
- **Google Search Grounding**: Ferramenta nativa do Gemini para busca na internet, usada como fallback
- **yt-dlp**: Ferramenta CLI de download de vídeos de redes sociais (Twitter/X, Instagram)

## 🆘 Problemas Comuns

### Bot não responde
1. Verifique se o número está correto no `.env`
2. Veja os logs em busca de erros de API

### QR Code não aparece
1. Delete a pasta `auth_info/`
2. Reinicie o bot
3. Certifique-se de ter conexão com internet

### Stickers não são criados
1. Confirme que FFmpeg está instalado: `ffmpeg -version`
2. Verifique permissões de escrita na pasta `temp/`
3. Imagens devem ser < 5MB

## 📞 Suporte

- **Documentação Técnica**: Leia os arquivos em `docs/`
- **Issues**: Abra uma issue no GitHub com logs completos
- **Discussões**: Use a aba Discussions para dúvidas gerais

---

**Próximo passo**: Leia [01-arquitetura.md](./01-arquitetura.md) para entender o fluxo de dados do sistema.