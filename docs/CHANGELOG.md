# Changelog — LumaBot

## [7.2.1] — 2026-06-17

### Fixed / Changed: descoberta das personas custom e figurinhas

- **`src/config/constants.js`** — subcomandos `criar`/`deletar` do `!persona`
  saíram dos literais hardcoded e viraram `COMMANDS.PERSONA_CREATE_SUB` /
  `PERSONA_DELETE_SUB`. `LumaPlugin` passou a consumir as constantes.
- **`src/config/constants.js` (`MENUS.HELP_TEXT`)** — `!persona criar` e
  `!persona deletar pN` agora aparecem no `!help` (antes só `!persona`).
- **`src/config/lumaConfig.js`** — `create_persona` e `create_sticker` ficaram
  mais sensíveis no function calling: descrições com mais gatilhos
  (virar/ser/imitar/responder como; stickeriza/vira figurinha/fig) e instrução
  `OBRIGATORIAMENTE` correspondente nos prompts de texto e de visão.

---

## [7.2.0] — 2026-06-17

### Added: Personas customizadas via chat

Qualquer membro pode criar uma persona da Luma a partir de uma descrição livre —
por comando (`!persona criar <descrição>`) ou em linguagem natural (tool
`create_persona`). A IA estrutura a descrição num shape validado, a persona é
persistida **por chat** (`JID`) e ativada na hora. Custom são deletáveis;
predefinidas continuam imutáveis.

- **`src/services/Database.js`** — tabela `custom_personas` no
  `luma_private.sqlite` (`UNIQUE (chat_jid, key)` + índice
  `idx_custom_personas_chat`) e CRUD estático
  (`createCustomPersona` / `getCustomPersonas` / `getCustomPersona` /
  `deleteCustomPersona` / `countCustomPersonas`).
- **`src/core/services/PersonaGenerator.js` (novo)** — recebe `aiService` por DI;
  `generate(description)` monta o prompt, parseia/valida/trunca o JSON, anexa o
  trait de formato do WhatsApp pelo sistema e faz 1 retry em JSON malformado.
  `slugify(name, existingKeys)` deriva key única.
- **`src/managers/PersonalityManager.js`** — resolução custom → predefinida →
  default; `getList(jid)` mescla as duas origens (`isCustom`); `deletePersona`
  com fallback da ativa para a padrão.
- **`src/plugins/luma/LumaPlugin.js`** — subcomandos `!persona criar` e
  `!persona deletar pN`; menu unificado com marcadores `⭐ (Padrão)` / `🗑️`.
- **`src/handlers/ToolDispatcher.js`** + **`src/config/lumaConfig.js`** — tool
  `create_persona` reusa o mesmo caminho do comando.
- **Limite** de 10 personas custom por chat; **telemetria** agregada
  (`personas_created` / `personas_deleted`) no banco público, sem JID nem conteúdo.
- Docs: [`docs/09-personas-custom.md`](09-personas-custom.md) e ADR
  [`docs/adr/0001-personas-custom-por-chat.md`](adr/0001-personas-custom-por-chat.md).

---

## [7.1.2] — 2026-06-12

### Correção: salvar env no dashboard falhava em produção (filesystem read-only)

Editar uma variável `source: env` (ex: `GEMINI_API_KEY`) no dashboard não
funcionava no deploy cloud: o container roda com filesystem read-only e o
`.env` é baked na imagem → `EROFS: read-only file system, open '/app/.env'`.
Pior, o frontend engolia o erro e o botão "Salvar" parecia não fazer nada.

- **`src/config/EnvStore.js` (novo)** — camada de override de env em
  `data/env-overrides.json` (volume gravável), espelhando o `ConfigStore`.
  `applyToProcessEnv()` injeta os overrides em `process.env`.
- **`src/config/env.js`** — após o `dotenv.config`, aplica `EnvStore` por cima
  do `.env` (o `.env` continua sendo a base; o dashboard tem prioridade).
- **`src/config/configService.js`** — `updateEnvFile` grava no `EnvStore` em vez
  do `.env`; `readConfig` recarrega/aplica o `EnvStore` para o painel refletir o
  valor efetivo. As edições de env agora persistem por reinício do container.
- **`dashboard/web/src/pages/Config.tsx`** — `save()` passa a tratar o erro e
  exibir um box vermelho com a mensagem (antes a falha era silenciosa).
- Testes em `tests/unit/config/configService.test.js` cobrindo a gravação via
  `EnvStore` (sem tocar no `.env`).

---

## [7.1.1] — 2026-06-12

### Refatoração: `dashboard/server.js` modularizado

O backend do dashboard era um monólito de ~735 linhas. Foi quebrado em módulos de
responsabilidade única, **sem alterar a interface externa** (rotas, eventos de
WebSocket, deploy, tunnel, sinais de stdout e shutdown idênticos).

- `dashboard/config.js` — `export const config`: env, paths calculados e constantes (TTL, janelas de rate-limit). Único leitor de `process.env` do dashboard.
- `dashboard/logger.js` — buffer circular + `pushLog`/`getLogs` e `setBroadcast(fn)` (broadcast injetado, sem acoplar aos WebSockets).
- `dashboard/auth.js` — sessões, `checkRateLimit` genérico (stores isoladas por nome) e middlewares `apiAuth`/`webAuth`.
- `dashboard/botManager.js` — classe `BotManager` (singleton): processo do bot, QR, parsing de `[LUMA_QR]:`/`[LUMA_STATUS]:`, estado; notifica via `setOnStateChange`.
- `dashboard/tunnelManager.js` — classe `TunnelManager` (singleton): cloudflared, backoff, modo supervisionado; notifica via `setOnUrlChange`.
- `dashboard/deploy.js` — `verifyGitHubSignature` + `scheduleDeploy` (debounce 5 s).
- `dashboard/websocket.js` — `setupWebSocket(server)`: auth, estado inicial, ping e wiring do broadcast.
- `dashboard/routes/api.js` — `apiRouter` com rotas públicas + sub-router protegido em `/api`.
- `dashboard/server.js` — agora só o ponto de entrada (~65 linhas).

> O `apiAuth` é aplicado num sub-router montado em `/api`, não via
> `router.use(apiAuth)` global — que rodaria para `/` e os estáticos e quebraria
> a SPA / login.

### Correção: config do dashboard voltava ao default ao recarregar a página

`src/config/configService.js`:

- `readConfig()` lia os campos `source: 'config'` a partir do snapshot de
  `CONFIG`/`LUMA_CONFIG` importado no boot — congelado. Após salvar, o
  `ConfigStore` era atualizado, mas o snapshot não; ao recarregar, o painel
  mostrava o valor antigo (parecia "voltar ao default").
- Agora `readConfig()` faz `ConfigStore.reload()` + `dotenv.config({ override: true })`
  a cada chamada, e `readFieldValue` prefere o override vivo ao snapshot. Os
  campos `source: 'env'` passam a refletir o `.env` em disco.
- Novo teste `tests/unit/config/configService.test.js` cobrindo a regressão
  (config e env refletem o valor salvo na leitura seguinte).

---

## [7.1.0] — 2026-06-01

### Tunnel independente do dashboard (`luma-tunnel`)

**Problema:** o Cloudflare Tunnel era spawned como processo filho do `dashboard/server.js`. A cada restart do PM2 (deploy ou crash) o `shutdownChildren` matava o tunnel, que subia novamente gerando uma URL nova no `trycloudflare.com`.

**Solução:** o tunnel passa a rodar como processo PM2 irmão (`luma-tunnel`), desacoplado do ciclo de vida do dashboard.

- `dashboard/tunnel.js` (novo) — wrapper standalone: spawna o `cloudflared`, captura a URL e a persiste em `data/tunnel-url.txt`.
- `dashboard/server.js` — quando `IS_SUPERVISED` (PM2/launcher), `startTunnel()` lê `data/tunnel-url.txt` e observa mudanças com `fs.watch` em vez de spawnar o `cloudflared`. `shutdownChildren()` não mata o tunnel nesse modo.
- `ecosystem.config.cjs` — novo app `luma-tunnel` (autorestart, backoff de 5 s).

**Migração:**
```bash
pm2 stop luma
pm2 start ecosystem.config.cjs --only luma-tunnel
pm2 start ecosystem.config.cjs --only luma
pm2 save
```

### Correção: chave de API herdada do processo pai

- `src/config/env.js`: `dotenv.config()` → `dotenv.config({ override: true })`.
  Antes, se o dashboard atualizava `process.env.DEEPSEEK_API_KEY` via edição de config e depois reiniciava o bot, o bot herdava o valor em memória do dashboard, ignorando o `.env` em disco (dotenv é idempotente por padrão). Com `override: true`, o `.env` é sempre a fonte de verdade para o processo do bot.

---

## [7.0.0] — 2026-05-31

### Resolução de usuários por JID (`UserResolver`, `wa_users`)

- Nova camada `src/core/services/UserResolver.js` — o JID/LID é a identidade técnica estável; o melhor nome humano disponível é escolhido na exibição.
- Ordem de prioridade do nome: `botNickname` → `pushName` → `notify` → `contato` → `verificado` → fallback `@últimos6` dígitos do identificador técnico.
- Nova tabela `wa_users` em `luma_private.sqlite` (jid, lid, phone_number, push_name, contact_name, notify_name, verified_name, bot_nickname, timestamps). Campos vazios nunca sobrescrevem dados bons.
- `ConnectionManager` registra `contacts.upsert` e `contacts.update` para enriquecer perfis a partir dos eventos do Baileys.
- `MessageRouter` faz upsert do remetente (com `pushName`) e registro básico dos JIDs mencionados em toda mensagem (chokepoint único). Nunca bloqueia o processamento em caso de falha.
- Comandos `!nick <nome>` (próprio apelido) e `!apelido @fulano <nome>` (apelido de terceiros) via novo `UserPlugin`. `bot_nickname` tem prioridade máxima.
- `BaileysAdapter.sendText`/`reply` agora repassam `mentions` ao payload (corrige bug onde menções em replies eram ignoradas — ex: a mensagem de kick).

### Ranking de interações com a Luma (`RankPlugin`, `luma_interactions`)

- Conta apenas interações reais com a Luma (trigger/reply/PV), incrementadas em `LumaPlugin.onMessage`. Não conta toda mensagem do grupo nem ações de mídia.
- Nova tabela `luma_interactions` (group_jid, sender_jid, count, last_at) em `luma_private.sqlite`. `'_pv_'` agrupa conversas privadas no ranking global.
- Comandos `!rank` (ranking do grupo) e `!rank global` (agregado de todos os chats). Nomes resolvidos via `UserResolver` — a chave de persistência é sempre o JID.

### Lembretes (`ReminderService`, `ReminderScheduler`, tool `schedule_reminder`)

- Agendamento por linguagem natural ("Luma, me lembre de X na próxima terça às 16h") via function calling: a IA calcula o `datetime` ISO 8601 absoluto (fuso `-03:00`) a partir do `{{CURRENT_DATETIME}}` já injetado no prompt; o `ToolDispatcher` valida e persiste.
- Comando manual `!lembrete DD/MM/AAAA HH:mm | texto` (alias `!lembrar`) via `ReminderPlugin`.
- Ao disparar, menciona as pessoas marcadas na mensagem (uma ou várias) no grupo, ou avisa no PV. Sem menção, lembra quem criou.
- Nova tabela `reminders` em `luma_private.sqlite`; `ReminderScheduler` (loop de 30s, iniciado na conexão) recupera lembretes vencidos durante downtime — **sobrevivem a reinícios do bot**.
- `ReminderService` valida: data no futuro, horizonte máximo de 1 ano, texto não-vazio; deduplica menções.

### Camada de override de configuração (`ConfigStore`, `configSchema`, `configService`)

- `src/config/ConfigStore.js` — overrides persistidos em `data/config-overrides.json` (fora do git) são mesclados (deep-merge) sobre os defaults de `constants.js`/`lumaConfig.js` no boot. Falha de parse cai para os defaults sem derrubar o bot.
- `src/config/configSchema.js` — esquema declarativo de toda a config editável (env + objetos de config), consumido pelo dashboard e pela validação do backend.
- `src/config/configService.js` — lê valores atuais (secrets mascarados) e grava alterações: env vai para o `.env` (e atualiza `process.env` para o próximo spawn), config vai para o `ConfigStore`. Mudanças aplicam no restart.
- `TRIGGERS` editáveis como strings (convertidas de volta para `RegExp` em runtime).

### Dashboard reescrito (Vite + React + TypeScript + Tailwind + shadcn-style)

- Novo app em `dashboard/web/` com identidade visual da marca **Thera** (roxo `#8B2FE0`, azul `#0A6CE0`, dark, off-white), mobile-first e 100% responsivo. Fontes self-hosted (Space Grotesk / IBM Plex Sans / JetBrains Mono) para respeitar o CSP `'self'`.
- Telas: **Overview** (status, controles start/stop/restart, QR, métricas), **Logs** (tempo real via WebSocket, filtros + busca), **Config** (edita tudo de `src/config` a partir do schema), **Social** (ranking + edição de apelidos), **Lembretes** (listar/cancelar), **Login**.
- `dashboard/server.js` ganha API REST: `GET/PUT /api/config`, `GET /api/users`, `PUT /api/users/:jid/nick`, `GET /api/ranking`, `GET/DELETE /api/reminders`. Todas protegidas por sessão, secrets mascarados, body ≤10 KB, rate-limit. Sinais de stdout (`[LUMA_QR]`, `[LUMA_STATUS]`) preservados.
- O servidor serve o build (`dashboard/web/dist`) quando presente; cai no dashboard legado em `src/public` caso contrário.

### Deploy automático e supervisão

- `runDeploy` (webhook `/api/deploy`, push na `main`) agora também roda `npm ci` + `npm run build` do dashboard (regenera o `dist`) e reinicia o próprio processo quando supervisionado — aplicando backend **e** painel sem tocar no servidor.
- `dashboard/launch.js` — supervisor mínimo: mantém o comando `npm run dashboard` e reinicia o `server.js` no deploy (saída código 0) ou em crash (backoff). Mata o bot-filho ao reiniciar, evitando sessão WhatsApp duplicada.
- `ecosystem.config.cjs` (PM2) para produção: autorestart + persistência no boot via `pm2 startup`. Marca `LUMA_SUPERVISED=1`.
- Novos scripts: `dashboard:web:dev`, `dashboard:build`, `pm2:start`, `pm2:restart`. `npm run dashboard` passa a usar o launcher.

### Correções

- `tests/unit/WebSearchService.test.js`: mocka `env.js` (que é congelado no import) para que o ramo Tavily seja exercitado — 2 testes que falhavam por isso agora passam. Suite 100% verde.

---

## [6.5.0] — 2026-05-05

### Hardening de Segurança (dashboard, IA, mídia, roteador)

**Dashboard (`dashboard/server.js`, `src/public/`)**

- Sessões substituem o token estático: `POST /api/login` agora devolve um token aleatório de 64 hex chars (via `crypto.randomBytes(32)`) com TTL de 7 dias; a senha não é mais exposta em cookies nem em `localStorage`
- Cookie `dash_token` reconfigurado como `httpOnly: true` + `sameSite: strict` — inacessível ao JavaScript da página
- `getToken` remove a leitura de query string (`?token=`), eliminando vazamento de credencial em logs de proxy
- WebSocket autenticado via cookie (nunca via query string)
- Rate limiting: 10 tentativas de login por IP/15 min; 10 requisições de controle do bot por IP/min
- Headers de segurança adicionados globalmente: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Content-Security-Policy`
- Corpo de requisição JSON limitado a 10 KB
- `verifyGitHubSignature` corrigida: guarda de comprimento antes de `timingSafeEqual` evita exceção quando assinaturas têm tamanhos diferentes
- Frontend remove armazenamento de token em `localStorage`; usa `credentials: 'include'` nas chamadas `fetch`

**Injeção de comandos via shell (`VideoConverter`, `VideoDownloader`, `MediaProcessor`)**

- Todas as chamadas `exec(cmd_string)` substituídas por `execFile(bin, args[])` — shell não é mais invocado, eliminando a superfície de injeção de comandos via nomes de arquivo maliciosos
- Nomes de arquivos temporários trocados de `Date.now()` (previsível) para `crypto.randomUUID()` (não-adivinhável)

**SSRF em URLs de usuário (`MediaProcessor`)**

- `assertSafeUrl` bloqueia protocolos não-HTTP/S e IPs privados/loopback (RFC 1918, 169.254/16, multicast) antes de qualquer requisição de rede
- `safeFetch` impõe timeout de 30 s e limite de bytes via streaming, evitando respostas infinitas

**Prototype pollution (`OpenAIAdapter`)**

- `#normalizeSchema` filtra explicitamente as chaves `__proto__`, `constructor` e `prototype` ao copiar objetos de schema

**JSON corrompido (`SQLiteStorageAdapter`, `Database`)**

- `JSON.parse` encapsulado em try/catch com fallback seguro (`[]` ou `null`) nos dois pontos que liam dados do banco sem tratamento

**Rate limiting por JID (`MessageRouter`)**

- Máximo de 10 mensagens por JID por segundo; mensagens excedentes são descartadas com log
- Truncagem de `body` (4096 chars) e `senderName` (100 chars) antes de repassar ao `MessageHandler`

**Path traversal (`FileSystem`)**

- `assertSafePath` introduzida para validar que operações de arquivo ficam dentro do projeto
- Corrigido: base de comparação trocada de `./temp` para raiz do projeto (`path.resolve(".")`), permitindo diretórios legítimos como `auth_info` sem abrir brechas reais de traversal

---

## [6.4.1] — 2026-04-28

### Contexto de mensagens citadas: texto, imagem e figurinha

**Enriquecimento de contexto ao citar qualquer mensagem (`LumaHandler`, `BaileysAdapter`)**

- Quando o usuário aciona a Luma respondendo a qualquer mensagem (não apenas à própria Luma), o conteúdo citado é injetado automaticamente no prompt com o autor de cada turno
- Três casos cobertos pelo enriquecimento em `LumaHandler.handle()`:
  - Mensagem de texto → `[citando Autor: "texto"]`
  - Imagem/figurinha com legenda → `[citando Autor: imagem com legenda "texto"]`
  - Imagem/figurinha sem legenda → `[citando Autor: figurinha — analise visualmente]`
- O tipo visual (`imagem` vs `figurinha`) é derivado da presença de `imageMessage` ou `stickerMessage` na quoted
- Quando o contexto injetado é o único `userMessage` (usuário não escreveu texto adicional), o early-return de "mensagem vazia" é evitado — `generateResponse` é chamado e `_extractImage` baixa e envia a imagem ao Gemini para análise visual real
- `BaileysAdapter` ganha getter `quotedHasVisualContent`: verifica `imageMessage` e `stickerMessage` na mensagem citada após unwrap de envelopes (`ephemeralMessage`, `viewOnceMessageV2`, etc.)
- `quotedSenderName` resolve corretamente o autor da citação: `"Luma"` se o bot, nome do remetente atual se citou a própria mensagem, `"Alguém"` nos demais casos

---

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
