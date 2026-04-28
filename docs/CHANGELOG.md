# Changelog — LumaBot

## [6.4.0] — 2026-04-28

### Contexto conversacional: memória por pessoa em grupos + continuidade de tópico

**Histórico por pessoa em grupos (`BaileysAdapter`, `LumaPlugin`, `LumaHandler`)**

- `BaileysAdapter` expõe novo getter síncrono `senderJid`: retorna `message.key.participant` em grupos, `remoteJid` em PV — compatível com JIDs no formato `@lid` (dispositivos linkados)
- `LumaPlugin.onMessage` calcula `historyKey = groupJid:senderJid` em grupos e `jid` em PV, passando para toda a cadeia (`handle`, `handleAudio`, `_respondWithMessage`)
- `LumaPlugin.onCommand` usa a mesma chave no `!luma clear` — limpa apenas o histórico de quem digitou o comando, não do grupo inteiro
- `LumaHandler.generateResponse` recebe `historyKey` como parâmetro opcional (default = `userJid`); `ConversationHistory` é lido e gravado com essa chave; `PersonalityManager` continua usando `userJid` (personalidade por grupo)
- Resultado: múltiplas pessoas podem conversar com a Luma simultaneamente no mesmo grupo sem cruzamento de contexto; o `#groupBuffer` (15 mensagens recentes do grupo) continua provendo consciência coletiva via `groupContext`

**Continuidade de tópico (`ConversationHistory`, `lumaConfig`)**

- `ConversationHistory.add` normaliza a resposta antes de salvar: marcadores `[PARTE]` são removidos e espaços duplos colapsados — o histórico armazena sempre texto limpo independente do número de balões enviados
- Removido o separador `[USUÁRIO ATUAL]` do `PROMPT_TEMPLATE` e do `VISION_PROMPT_TEMPLATE`: a mensagem atual flui diretamente após o histórico, mantendo a conversa como um único bloco contínuo
- Adicionadas duas instruções em `[NATURALIDADE]`: (3) respostas curtas e vagas são sempre interpretadas como continuação do turno anterior; (4) mudança clara de assunto é seguida sem tentar conectar ao histórico antigo
- Testes: `LumaPlugin.test.js` atualizado para refletir o novo parâmetro `historyKey` e o getter `senderJid` no mock do `BaileysAdapter`

---

## [6.3.0] — 2026-04-20

### Processamento paralelo por JID (`JidQueue`, `MessageRouter`)

- Novo `src/infra/JidQueue.js` — fila de promises por JID: mensagens do mesmo chat são serializadas, chats diferentes processam em paralelo sem nenhum bloqueio global
- `MessageRouter` substituiu o `await` serial por `queue.enqueue(botAdapter.jid, fn)` — cada JID avança na sua própria cadeia de promises independente
- Erros em uma mensagem não bloqueiam as seguintes do mesmo JID: a cadeia usa `prev.catch(log).then(fn)`, garantindo continuidade mesmo em falha
- Cleanup automático: o Map interno remove a entrada do JID assim que a fila drena, sem acúmulo de memória
- `Promise.all(pending)` no `routeMessages` mantém a função awaitable (retrocompatibilidade com testes e integração)
- Novo `tests/unit/infra/JidQueue.test.js` com 8 casos: paralelismo entre JIDs, serialização dentro do JID, resiliência a falhas, limpeza pós-drenagem
- `tests/unit/infra/MessageRouter.test.js` atualizado: mock do `JidQueue` como passthrough + mock do `BaileysAdapter` com propriedade `jid`; adicionado caso `encaminha o jid correto para o BaileysAdapter`

---

## [6.2.0] — 2026-04-20

### Download de Áudio (`AudioDownloadPlugin`, `VideoDownloader`, `CommandRouter`, `constants`)

- Novo plugin `AudioDownloadPlugin` com comandos `!audio` e `!a`
- Extrai URL do corpo da mensagem ou do texto citado (mesmo comportamento do `!download`)
- Usa yt-dlp com `-x --audio-format mp3 --audio-quality 0` — funciona com qualquer URL suportada pelo yt-dlp (YouTube, Twitter/X, Instagram, etc.)
- Thumbnail do vídeo embutida como cover art ID3 (APIC) via `--embed-thumbnail --convert-thumbnails jpg`; exibida pelo WhatsApp como artwork na bolha de áudio
- Metadados (título, artista, álbum) embutidos via `--embed-metadata`
- Título buscado em paralelo com o download (`--skip-download --print "%(title)s"`, timeout 15 s) — sem overhead de tempo
- `fileName` da mensagem usa o título real do vídeo (máx. 100 chars, caracteres inválidos substituídos por `-`); fallback para `"audio.mp3"`
- `VideoDownloader.downloadAudio()` retorna `{ filePath, title }` em vez de `string`
- `VideoDownloader._fetchTitle()` — método privado de busca de metadados; falha silenciosa (retorna `null`)
- Arquivos temporários limpos no `finally` independentemente de sucesso ou falha
- Métrica `audios_downloaded` incrementada no SQLite a cada download bem-sucedido

### Function Calling — `show_help` (`lumaConfig`)

- Adicionada declaração da ferramenta `show_help` no array `LUMA_CONFIG.TOOLS` — o handler já existia no `ToolDispatcher` mas nunca era acionado por falta da declaração
- Instrução obrigatória adicionada em `PROMPT_TEMPLATE` e `VISION_PROMPT_TEMPLATE`: quando o usuário perguntar o que a Luma faz ou quais comandos existem, `show_help` é chamada obrigatoriamente
- Resultado: a Luma responde com uma frase na sua personalidade e envia o menu completo de comandos (`MENUS.HELP_TEXT`)

---

## [6.1.0] — 2026-04-18

### Auto-Deploy via GitHub Webhook (`dashboard/server.js`)
- Novo endpoint `POST /api/deploy` com autenticação HMAC-SHA256 (`x-hub-signature-256`)
- Deploy só dispara para pushes em `refs/heads/main`; outras branches retornam 200 silencioso
- Lógica de debounce de 5 s: pushes em rajada viram um único deploy — só o estado mais recente é aplicado
- Sequência assíncrona pós-resposta: `git pull` → `npm install` condicional (só se `package.json` ou `package-lock.json` mudou) → `restartBot()`
- Endpoint desativado automaticamente quando `DEPLOY_WEBHOOK_SECRET` não está configurado

### Visão para Providers sem Suporte Multimodal (`LumaHandler`, `GeminiAdapter`, `AIProviderFactory`)
- `GeminiAdapter` ganha propriedade `supportsVision = true`; wrapper OpenAI/DeepSeek ganha `supportsVision = false`
- `LumaHandler` cria automaticamente um `GeminiAdapter` secundário (`visionService`) quando o provider principal não suporta visão e `GEMINI_API_KEY` está disponível
- Quando chega uma imagem: Gemini descreve em português → descrição injetada no prompt como texto → imagem em base64 nunca chega ao DeepSeek

### Migração `AIService` → `GeminiAdapter` (`AIProviderFactory`)
- `createAIProvider` agora instancia `GeminiAdapter` para o provider `gemini` em vez do `AIService` legado
- `AIService.js` removido (código era duplicata exata do `GeminiAdapter` sem extensão de `AIPort`)
- Testes de `AIProviderFactory` e `MessageHandler` atualizados para mockar `GeminiAdapter`

### Reconexão após Logout Manual (`ReconnectionPolicy`)
- Corrigido bug de ordem de verificação: `errorMessage.includes('Connection Failure')` era avaliado antes de `isAuthenticationError(statusCode)`
- Status 401 com mensagem `"Connection Failure"` (logout do celular) agora retorna `clean_and_restart` → limpa `auth_info` → exibe QR code
- Antes: entrava em loop infinito de `retry_connection`

### Remoção Aleatória no Grupo (`ToolDispatcher`)
- Quando `remove_member` é acionado sem alvo identificável (sem menção, sem número válido), a Luma sorteia um membro não-admin (excluindo ela mesma e quem pediu)
- Mensagem de kick no sorteio não revela que foi aleatório: `"Já sabia que era você, @fulano. Tchau 👋"`

### Contexto de Grupo — Limpeza com `!lc` (`LumaPlugin`)
- `!luma clear` agora também apaga o `#groupBuffer` do grupo além do `ConversationHistory`
- Antes: limpar o histórico não impedia que o contexto recente do grupo influenciasse respostas subsequentes

### Limite de Caracteres Repetidos (`ResponseFormatter`)
- `cleanResponseText` agora colapsa sequências de caracteres repetidos acima de 30 para exatamente 30
- Evita que respostas como `"kkkkkkk..."` se partam em múltiplas mensagens de spam

### Contexto Temporal no Prompt (`PromptBuilder`, `lumaConfig`)
- Data e hora de Brasília (`America/Sao_Paulo`) injetadas em todo prompt via placeholder `{{CURRENT_DATETIME}}`
- Formato: `"sexta-feira, 18 de abril de 2026 às 15:34"` — recalculado a cada mensagem

### Dashboard — Botão de Filtro INFO (`styles.css`)
- Adicionadas regras `.filter-btn.info`, `.filter-btn.info:hover` e `.filter-btn.info.active`
- Botão INFO agora usa `--c-cyan` (`#44eeff`), alinhado visualmente com a cor dos logs `INFO`

---

## [6.0.0] — versão anterior

Arquitetura hexagonal com Ports & Adapters, Plugin System e Injeção de Dependências.
