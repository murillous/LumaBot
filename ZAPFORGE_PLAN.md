# ZapForge — Plano do Kernel

> Documento de planejamento consolidado a partir da sessão de levantamento de requisitos
> de 2026-10-06. Fonte única de verdade para criar o GitHub Project (milestones, issues e
> sub-issues). Cada decisão aqui deve virar um ADR no M0.

---

## Sumário

1. [Visão](#1-visão)
2. [Contexto: por que extrair um kernel do LumaBot](#2-contexto-por-que-extrair-um-kernel-do-lumabot)
3. [Diagnóstico do LumaBot atual](#3-diagnóstico-do-lumabot-atual)
4. [Decisões](#4-decisões)
5. [Arquitetura](#5-arquitetura)
6. [API pública (esboços)](#6-api-pública-esboços)
7. [Metas de performance](#7-metas-de-performance)
8. [Governança, licença e modelo comercial](#8-governança-licença-e-modelo-comercial)
9. [Roadmap: milestones, issues e sub-issues](#9-roadmap-milestones-issues-e-sub-issues)
10. [Checklist de paridade com o legacy](#10-checklist-de-paridade-com-o-legacy)
11. [Fora de escopo da v1](#11-fora-de-escopo-da-v1)
12. [Sugestão de organização do GitHub Project](#12-sugestão-de-organização-do-github-project)

---

## 1. Visão

**ZapForge** é um *kernel* para bots de mensageria (WhatsApp, Discord, Telegram e sistemas web
próprios, D55) que contém apenas
o indispensável — conexão, modelo de mensagem, roteamento, filas, armazenamento, configuração
e ciclo de vida de plugins. **Todo o resto é plugin.**

Objetivos:

- **A comunidade cria plugins sem conhecer o funcionamento interno.** O contrato público
  (tipos TypeScript + docs + kit de testes) é o produto.
- **Máximo de performance**, com metas mensuráveis e benchmark no CI.
- **Multiplataforma**: o core só conhece o contrato do `Transport`; o que é de cada plataforma
  fica no transport. Baileys no M2 e `transport-web` (chatbot dentro de sistemas próprios, como
  ERP e gestão escolar) no M3 validam o contrato antes do 1.0; Telegram e Discord vêm depois. API
  Oficial do WhatsApp (Cloud API), Twilio e Zenvia no futuro, para uso comercial.
- **Open core**: kernel, plugins básicos e transports Baileys, web, Telegram e Discord públicos;
  transports comerciais de WhatsApp e integrações privadas.

Analogia guia — **mods de Minecraft**: plugins (mods) são feitos pela comunidade e rodam sobre
diferentes *runners* (Fabric, Forge, NeoForge ↔ Baileys, web, Telegram, Discord). Nem todo plugin
roda em todo transporte, e o plugin declara o que precisa.

O **LumaBot** deixa de ser o produto e passa a ser o **app de referência**: a Luma (IA com
persona) vira um plugin do ZapForge.

---

## 2. Contexto: por que extrair um kernel do LumaBot

O LumaBot é um bot de WhatsApp completo (Baileys 7, Gemini/OpenAI/DeepSeek, SQLite, Sharp,
FFmpeg, dashboard React) com arquitetura hexagonal, plugins e DI. A intenção já existia, mas a
implementação tem vazamentos que impedem que terceiros escrevam plugins sem ler o código
interno. Em vez de refatorar in-place (arrastando os débitos), o kernel nasce do zero num
monorepo, usando o LumaBot como **referência de leitura** e como **primeiro consumidor** que
valida que a API de plugins é suficiente.

### O que reaproveitar como referência

| Peça atual | Por que é boa | Destino |
|---|---|---|
| `src/infra/JidQueue.js` | Serializa o mesmo chat, paraleliza chats distintos — modelo de concorrência correto | Core (fila de entrada) |
| `src/infra/ReconnectionPolicy.js` | Separa decisão de execução | Core (quase como está) |
| `src/plugins/PluginManager.js` | Índice de comandos O(1), hooks de lifecycle | Ideia mantida, implementação refeita |
| `src/infra/Container.js` | DI lazy/singleton | Substituído por instância `Bot` + service registry tipado |
| `BaileysAdapter.unwrapMessage` | Desempacota ephemeral/viewOnce/documentWithCaption | `transport-baileys` |
| `src/core/ports/*` | Primeiros contratos de porta | Referência para `Transport` e `StoragePort` |

---

## 3. Diagnóstico do LumaBot atual

Débitos que **impedem** um kernel de verdade e que o ZapForge deve corrigir por design:

| # | Débito | Evidência | Correção no ZapForge |
|---|---|---|---|
| 1 | `MessagingPort` vaza o Baileys | `bot.socket`, `bot.raw`, `bot.innerMessage` usados em `GroupService`, `LumaHandler`, `ToolDispatcher`, `SpontaneousHandler` | Modelo de mensagem normalizado + `media.download()` + capabilities; escape hatch explícito `ctx.unsafe.native` |
| 2 | Comandos centralizados | `CommandRouter` é um `if` gigante sobre `COMMANDS`; criar comando = editar 3 arquivos do core; `includes()` gera falsos positivos | Comandos declarados pelo plugin; match por token inicial exato; conflito = erro no boot |
| 3 | Registro de plugins hardcoded | `MessageHandler.buildPluginManager()` importa `LumaHandler`, `AudioTranscriber`, `env` | Loader por config (npm) + `pluginDirs`; core não importa nenhuma feature |
| 4 | Estado global estático | `DatabaseService.*` em 11 arquivos; `SpontaneousHandler static #cooldowns`; `MessageHandler.#pm`; `Database.js` abre banco no import | Todo estado pendurado na instância `Bot`; zero side effect em import |
| 5 | DI pela metade | `Container`/`StoragePort` só usados em testes | `StoragePort` é o caminho real; services injetados via contexto |
| 6 | Dispatch sequencial sem isolamento | `onMessage` de todos os plugins com `await` em série; exceção ou trava afeta os demais | Listeners em paralelo, cada um com try/catch + timeout + log com nome do plugin |
| 7 | `MessageRouter` com múltiplas responsabilidades | Rate limit, sanitização, tracking de usuário e roteamento juntos; `rateLimiter` é um `Map` nunca limpo (vazamento) | Cada responsabilidade vira middleware; estruturas com expiração; teste de memória no benchmark |
| 8 | Higiene | 155 imports relativos; `export default` em `index.js`; `catch {}` vazio em `ConnectionManager.closeSafely`; `process.env` fora de `env.js` | Regras do Biome + aliases `@zapforge/*` + CI |
| 9 | Sem contrato de eventos | Só `messages.upsert` chega aos plugins | Barramento tipado: mensagem, reação, edição, deleção, grupo (entrada/saída/update), conexão, QR |
| 10 | Sem fila de saída | Só há rate limit de entrada; rajadas de envio arriscam ban | Fila de saída com taxa global/por chat, prioridade e retry |
| 11 | Auth em arquivos | `useMultiFileAuthState` (não recomendado pelo Baileys em produção) | Auth state no `StoragePort` (SQLite/Postgres) |
| 12 | Dashboard via stdout | Sinais `[LUMA_QR]`, `[LUMA_STATUS]` parseados de texto; processo filho | Dashboard vira plugin lendo o barramento de eventos via HTTP/WS do core |

---

## 4. Decisões

Cada linha = um ADR (`docs/adr/NNNN-*.md`, formato Contexto / Decisão / Consequências / Status).
D01–D31 foram escritas no M0; as seguintes nasceram nas issues que as exigiram e detalham uma
decisão anterior.

| ID | Decisão | Alternativas descartadas | Motivo |
|---|---|---|---|
| D01 | **Monorepo** (pnpm workspaces): `packages/*`, `plugins/*`, `apps/lumabot`, `legacy/` | Repo novo isolado; refatoração in-place | Kernel nasce limpo, LumaBot valida a API como consumidor real |
| D02 | **TypeScript** no kernel, publicado com `.d.ts`; plugins em TS ou JS | JS + JSDoc; JS puro | O contrato tipado é a DX que permite plugar sem ler o código |
| D03 | **`Transport` abstrato**, só Baileys na v1 (substituído por D55) | Multi-transporte já na v1; Baileys exposto | Abstração barata agora; Cloud API/Twilio/Zenvia viram adapters comerciais depois |
| D04 | **Uma sessão por processo, zero estado global** | Multi-sessão nativa | Escala com processos; multi-sessão futura = instanciar `Bot` duas vezes |
| D05 | **Plugins no mesmo processo**, isolados por try/catch + timeout + API restrita (sem socket) | Worker threads; sandbox com permissões | Performance; permissões declarativas só se houver marketplace público |
| D06 | **Luma é um plugin** (`plugin-ai`); IA não entra no core | IA embutida no kernel | Bot indispensável não exige IA; se a Luma couber como plugin, a API está provada |
| D07 | **Plugins via npm (config) e via pasta (`pluginDirs`)**, ambos produzem o mesmo objeto `Plugin` | Só npm; só auto-discovery | Flexibilidade com 3 regras: ordem explícita (`priority`/`after`), `name` obrigatório com enable/disable por nome, conflito de nome/comando = erro no boot |
| D08 | **Sem hot-reload de código** na v1 | Hot-reload | Vazamento de listeners e estado órfão; restart via PM2/Docker |
| D09 | **Modelo de mensagem normalizado** com union discriminada (`msg.type`), `msg.is()`, `msg.quoted` recursivo, `media.download()`/`stream()` lazy com cache por mensagem; `voice` (PTT) separado de `audio` | Expor objeto Baileys | DX tipada; resolve mídia própria vs citada uma vez só |
| D10 | **Capabilities do transporte**; plugin declara `requires`; kernel não carrega plugin incompatível (com aviso) + `UnsupportedError` em runtime como rede de segurança | Mínimo denominador comum; só erro em runtime | Não castra o Baileys; erro cedo e explícito (modelo Fabric/Forge) |
| D11 | **Escape hatch `ctx.unsafe.native`** tipado como `unknown`, com aviso no log; uso implica `transports: ['baileys']` | Não expor; expor normalmente | Comunidade não trava esperando o core; uso medido indica o que promover a API |
| D12 | **Pipeline de 3 estágios**: middlewares onion (Koa) → comando (token exato, consome a mensagem) → listeners em paralelo com `ctx.claim()` | Listeners em série com "primeiro que retornar true" | Performance + isolamento; resolve conflito Luma × Spontaneous |
| D13 | **Escopo do core**: conexão/reconexão/QR/pairing, Transport + Baileys, modelo de mensagem + envio, filas de entrada e saída, middlewares, comandos, eventos, lifecycle de plugins, storage, scheduler, logger, config, mídia | — | Ver seção 5 |
| D14 | **`StoragePort` com SQLite (padrão) e Postgres (oficial) já na v1**; auth state do WhatsApp no mesmo port | Só SQLite; só Postgres; memória | SQLite = "clona e roda"; Postgres = escala comercial multi-processo; dois adapters garantem que o port não vaza SQLite |
| D15 | **API de storage: KV com namespace + coleções** com `find`/filtros/ordenação/limite e índices declarados; sem SQL cru na API pública | Só KV; SQL com migrations por plugin | Cobre ranking e lembretes sem amarrar plugin ao engine |
| D16 | **Manifesto do plugin**: `name`, `version`, `engine` (semver do core, obrigatório), `requires` (capabilities), `transports` (opcional), `dependsOn` (semver) | Fixar sempre o transporte | Todos os transportes falam a mesma API — capability é mais precisa que runner |
| D17 | **Config por plugin com Zod 4**, campos `secret`; precedência env > arquivo > overrides do dashboard (storage) > default; mudança de config faz `teardown` → `setup` do plugin sem reiniciar o processo | Valibot; TypeBox; config manual | Zod exporta JSON Schema para o dashboard gerar formulários |
| D18 | **Service registry entre plugins** (`provides` / `ctx.services.get`) tipado por declaration merging | Interface de IA no core | Mantém D06; extrair `@zapforge/ai-contract` só se surgirem plugins de IA concorrentes |
| D19 | **Fila de saída anti-ban no core**: taxa global e por chat, prioridade (comando > broadcast), retry com backoff; humanização (presença "digitando") opcional por transporte | Responsabilidade do plugin | Essencial para uso comercial; `ctx.reply()` passa pela fila de forma transparente |
| D20 | **Servidor HTTP único no core** (Hono sobre `node:http`), sobe só se alguém registrar rota; `/health`; rotas com namespace `/plugins/<name>/...` | Servidor por plugin; nenhum HTTP | Webhooks de Cloud API/Twilio/Zenvia + dashboard numa porta só |
| D21 | **Dashboard vira plugin** (`plugin-dashboard`), lendo eventos do barramento e schemas de config; fim do protocolo stdout | Supervisor separado | Protocolo de stdout é frágil; plugin pesado valida a API. Dashboard central multi-número = projeto comercial futuro |
| D22 | **Kit de autor na v1**: `@zapforge/testing` (FakeTransport, `createTestBot`), `create-zapforge-plugin`, docs "primeiro plugin em 5 min" + referência via TypeDoc | Só docs | Sem kit de testes o ecossistema fica frágil; o próprio core usa o kit |
| D23 | **Migração incremental**: LumaBot atual em `legacy/` em produção, testes intactos; plugins portados por complexidade; virada na paridade | Big-bang | Produção não para; paridade é critério de aceite objetivo |
| D24 | **Papéis no core**: `owner` / `group-admin` / `everyone` verificados pelo roteador; allow/blocklist de chats como middleware oficial; papéis custom via middleware de plugin (substituído por D35) | Sem papéis | Hoje qualquer um pode alterar personas/config |
| D25 | **Sem i18n formal na v1**; mensagens ao usuário isoladas num objeto `messages` sobrescrevível pela config do plugin | `ctx.t()` na v1 | Público inicial BR; i18n entra depois sem quebrar |
| D26 | **Tooling**: Node 24 LTS+, pnpm, TS executado direto no Node em dev e `tsdown` para publicar (JS + `.d.ts`), Vitest, Biome | Node 18/20/22; tsup (em manutenção); ESLint + Prettier | LTS mais longo; pnpm estrito evita dependência fantasma em plugins; Biome = uma ferramenta, rápida |
| D27 | **Releases com Changesets**; `0.x` livre; após 1.0, remoção só após ciclo `@deprecated` de ≥ 1 minor; APIs novas podem nascer `@experimental` | Versionamento manual | Comunidade depende de `engine: '^1.0.0'` |
| D28 | **Licença Apache-2.0** no core e plugins públicos; `legacy/` continua MIT | MIT; AGPL dual | Concessão explícita de patentes, adequada a uso comercial |
| D29 | **Open core**: plugins/transports comerciais em **repo privado** na org `thera-org` do GitHub, publicados como pacotes privados na org npm da Thera e consumindo os pacotes **públicos** `@zapforge/*` (transports Discord, Telegram e web públicos: D55) | Pastas privadas no monorepo | Repo privado é o teste definitivo da API pública |
| D30 | **Metas de performance mensuráveis** com benchmark no CI (seção 7) | "Rápido" sem métrica | Sem régua não há aceite nem detecção de regressão |
| D31 | **Nome: ZapForge** (`@zapforge/*`) | zapcore (conflita com `go.uber.org/zap/zapcore`) | Org `zapforge` criada no npm em 2026-10-06; kernel e plugins públicos no GitHub sob a conta pessoal `murillous`; plugins privados ficam na `thera-org` (ver D29) |
| D32 | **Camadas da config de plugin** (detalha D17): env `ZAPFORGE_<PLUGIN>__<CAMPO>`; "arquivo" = `pluginConfig` do app; `messages` como chave reservada; `secret()` como metadado do Zod, só em campo de `z.object`; config inválida ignora só o plugin; segredo nunca entra por override | Env sem prefixo; `pluginMessages` separado; segredo por lista de caminhos; config inválida derruba o boot | Contrato estável para quem configura; erro isolado no plugin; storage em texto puro não guarda segredo |
| D33 | **Cancelamento cooperativo** (detalha D05): `signal: AbortSignal` em comando, listener, job e `PluginContext`, abortado pelos timers de prazo existentes; contexto expirado recusa efeitos com `ContextExpiredError`; `reason` tipado (`ExecutionTimeoutError`) | Worker threads; `AsyncLocalStorage` por execução; só documentar | O JS não mata promise: o plugin precisa saber do prazo, e o kernel não pode aceitar efeito atrasado |
| D34 | **ZapForge é uma biblioteca, sem runner**: o app importa `@zapforge/core` e compõe com `createBot`; sem CLI de execução nem `defineConfig`; API pública por público (`@zapforge/core` para plugin e app, `@zapforge/core/adapter` para transports/storages), internos fora do `index.ts` | Runner/CLI com `defineConfig`; um único ponto de entrada com tudo exportado | Quem usa o ZapForge escreve plugins e não precisa conhecer o kernel; tudo que é exportado fica preso ao ciclo de depreciação após a 1.0 |
| D35 | **Papéis custom nomeados por plugin** (substitui parte de D12/D24): `ctx.roles.define(nome, check)`, comando usa `role: nome`, tipado por declaration merging (`Roles`); o roteador avalia com prazo e recusa em erro (fail-closed); `owner` passa em todos | `ctx.middleware` de plugin; middleware + papéis; nada na v1 | Middleware roda antes do roteador e não sabe o comando; papel custom precisa caber num plugin |
| D36 | **Escopo de sessão** (detalha D04/D14): `createBot({ session })`, padrão `'default'`; namespaces de plugin, jobs, overrides de config e auth state no escopo da sessão, aplicado pelo kernel sem mudar o `StoragePort`; a mesma sessão não roda duas vezes (recusa no processo, `DisconnectReason` `'replaced'` entre processos) | Um banco por número como regra, sem escopo no core; sessão como parâmetro do port | Dois bots no mesmo banco disparavam os mesmos jobs e dividiam dados; um banco compartilhado por vários números passa a ser seguro |
| D37 | **Transport por fábrica** (detalha D03): `transport` aceita `Transport` ou `(deps) => Transport`, com `deps` = `session`, `auth`, `log`; fábrica síncrona e sem I/O; `clean-session` limpa o `auth` sozinho | `attach(deps)` opcional no `Transport`; ligação manual pelo app | O app não liga transport e storage à mão nem repete a sessão; o adapter loga com segredos censurados |
| D38 | **chatFilter e ignoreSelf nos eventos que não são mensagem** (detalha D24): o kernel aplica a config dos middlewares a `reaction`, `message.deleted` e `group.participants`/`group.updated` (`group.joined`/`left` sempre passam); `fromMe` em `reaction` e `message.deleted`; esses eventos esperam o boot, sem fila do chat | Middlewares genéricos sobre qualquer evento; comparar com `transport.self`; fila do chat | Chat bloqueado não fala com o bot por evento algum; reação do próprio bot não volta como laço; LID e JID impedem comparar ids no kernel |
| D39 | **Fila de saída pausa com a conexão caída e tem prazo por envio** (detalha D19): o `Bot` pausa a fila no `closed` e retoma no `open`, com teto `outbound.maxPauseMs` (60 s, depois `'disconnected'`); `stop()` com a conexão caída descarta em vez de drenar; `outbound.sendTimeoutMs` (30 s) por chamada ao transport, sem re-tentar no `'timeout'` | Retry padrão maior; fila assinando o transport; sem teto; timeout só no adapter | Resposta gerada numa queda curta não se perde; transport pendurado não prende o chat nem o `stop()` |
| D40 | **Ações e leituras do transport no plugin** (detalha D16/D19): toda escrita (`send`, `react`, `edit`, `delete`, `presence`, `groups.updateParticipants`) passa pela fila de saída via `enqueue`; `ctx.groups.metadata`, `ctx.commands.list()`, `ctx.self`, `ctx.capabilities`; `message.key` em toda `Message`; atalho `react` no contexto de mensagem; evento `contact.updated` | Só mensagens pela fila; nada pela fila; exportar `messageKey()`; `ctx.messages`; cache de metadata | Plugins do M4/M5 sem escape hatch; anti-ban cobre toda escrita |
| D41 | **Reload em cascata** (detalha D17/D18): `reload(x)` recarrega também os dependentes de `x` por `dependsOn` (transitivo): descem na ordem inversa, sobem na de carga, reavaliados como no boot (`dependency-skipped` se `x` falhar); `after` não entra; `PluginReloadResult.dependents` | Proxy no `services.get`; só documentar `get` a cada uso | Dependente pode guardar o serviço no `setup`; reload de config reinicia o subgrafo |
| D42 | **Comando e listener lentos seguram o chat** (detalha D05/D12): a fila do chat só avança quando o handler termina ou estoura o prazo (`commandMs`/`listenerMs`); `command({ timeoutMs })` opcional sobrescreve o `commandMs` só para aquele comando; trabalho longo sem dependência de ordem se solta do handler (responde rápido, segue sem `await`, `catch` próprio); descarte por fila cheia já sai em `warn` e `stats().inbound.dropped` | Listeners não seguram o chat; opt-in `holdsChat` por listener; worker threads para plugins | Ordem por chat mantida, como no legacy; um handler preso segura o chat até 30 s; trabalho solto fica sem prazo do bus nem `plugin.error` |
| D43 | **Middleware do app tem prazo** (detalha D12, completa D42): cada middleware tem `timeouts.middlewareMs` (padrão 30 s), contado só no tempo do próprio middleware (o relógio para no `next()` e volta com o que sobrou); estourado, a mensagem é descartada com `MiddlewareTimeoutError` no log e o chat é liberado; `next()` depois do prazo não roda comando nem listeners; middleware síncrono não arma timer; `stop()` desarma o timer | Só documentar; prazo total por mensagem na fila de entrada; prazo contado sobre a cebola inteira | O teto do ADR 0042 vale para todo código no caminho da mensagem; middleware que espera de propósito mais de 30 s precisa subir `middlewareMs` |
| D44 | **`bot.settled()` espera o bot processar o que recebeu** (detalha D22/D34): resolve quando fila de entrada, listeners assíncronos do barramento e fila de saída estão vazios na mesma conferência, esperando as três de novo enquanto não; listener que estoura o prazo deixa de contar; fila de saída pausada espera (teto `maxPauseMs`); jobs do scheduler ficam de fora; nunca rejeita | Expor as filas ou os `onIdle()`; nome `idle()`, que colide com `BotState`; contar jobs do scheduler; rejeitar com a fila pausada | O kit de testes implementa `receive()` sobre a API pública e asserções negativas ficam seguras; o caminho quente paga um incremento e um decremento por listener assíncrono |
| D45 | **Queda de rede nunca limpa a sessão** (detalha D03/D37): `connection-lost`/`unknown` reconectam com backoff sem limite de tentativas; `clean-session` só para `logged-out`, `auth-failed` e `qr-limit`; saem `maxReconnectAttempts` e a causa `reconnect-limit` | Limite que decide `stop` e deixa o supervisor reiniciar; limite opcional; manter e documentar | ~30 s de rede fora não apagam credenciais válidas nem exigem parear de novo no celular |
| D46 | **Ids de contato em espaços diferentes** (detalha D03/D09): `group-admin` casa o participante admin por id ou, quando os dois lados o têm, por `phone`; o contrato do `Transport` diz que ids podem vir em espaços diferentes (LID, JID de telefone), que o adapter preenche `phone` sempre que souber e que `getGroupMetadata` deve ser barato (cache no adapter, invalidado por `group.participants`/`group.updated`); o core segue sem cache | Transport normaliza tudo para um espaço só; cache de metadados no core | Admin com LID não é recusado em silêncio; cada comando de admin não vira ida à rede do WhatsApp |
| D47 | **A espera na fila de saída não conta no prazo do handler** (detalha D19/D33/D42): o prazo de comando e de listener pausa enquanto um `reply`/`react` do contexto não assenta (fila, humanização, retry, transport) e volta com o que sobrou; `ctx.send` do plugin, `ctx.groups` e jobs seguem contando; benchmark de vazão do M2-4 roda com os intervalos da fila de saída em 0 | `reply` resolve ao enfileirar; manter e documentar | Rajada em chats diferentes não vira `timedOut` falso; o chat fica preso só enquanto espera a própria resposta, limitado pelos tetos da fila |
| D48 | **`connect()` resolve ao iniciar a tentativa** (detalha D03/D39/D45): resolve com o socket criado, sem esperar o `open`, e rejeita só se nem começou; o andamento e as falhas vêm por `connection.status`; o reconector guarda o `closed` que chega antes do `activate()` ou durante um `connect()` de reconexão e decide sobre ele quando o `connect()` termina (um `open` depois o anula); a fila de saída nasce pausada até o primeiro `open` (teto `maxPauseMs` desde o `start()`); o scheduler segue ligando logo depois do `connect()` | `connect()` resolve no `open`; `connect()` rejeita quando a tentativa cai; scheduler liga no primeiro `open` | O restart 515 do Baileys depois do QR reconecta pela política; envios do `setup` e de jobs vencidos esperam o `open`; todo transport precisa emitir `open` |
| D49 | **Evento `command`** (detalha D12/D40): só de observação, sai para todo comando que casou, depois de ele terminar, com `{ plugin, name, invokedAs, status: 'ran' \| 'rejected' \| 'failed', message }`; sem `reply`; o `Bot` espera os listeners (seguram o chat, contam no `settled()`); toda mensagem admitida cai em `message` ou em `command` | Evento antes do roteador (`message.received`); middleware por plugin; manter e documentar | Atividade do spontaneous e métricas do dashboard contam comandos como no legacy; consumo do D12 não muda |
| D50 | **Código de pareamento por evento** (detalha D03/D13): evento do transport `connection.pairing-code` `{ code }`; o `Bot` o trata como o QR (conta para o `maxQrCount`, valor só em `debug`, vai ao barramento); quem pareia por código não emite `connection.qr` | Callback na opção do adapter; campo de tipo no `connection.qr` | O dashboard (plugin) exibe o código como exibe o QR; código expirado segue a política do QR |
| D51 | **SQLite pelo `node:sqlite`** (detalha D14/D15): o `storage-sqlite` usa o driver embutido no Node, sem addon nativo; schema fixo do adapter (KV, documentos com JSON em `doc`, auth state), índice declarado vira índice de expressão em `json_extract`; migrations só de acréscimo versionadas no `PRAGMA user_version`, aplicadas no boot; WAL com `synchronous = NORMAL` | `better-sqlite3` (addon nativo); tabela por coleção | `pnpm install` sem compilar nada; trocar o Node não quebra o storage; plugin continua sem SQL (D15) |
| D52 | **Kit de testes sobre o Vitest** (detalha D22/D44): `vitest` como peer dependency e matchers registrados no import do `@zapforge/testing`; `receive()`/`emit()` resolvem depois do `bot.settled()`; `createTestBot` com log `silent`, `env: {}`, fila de saída sem intervalo e sem reconexão; `FakeTransport` com todas as capabilities por padrão | Kit agnóstico sem matchers; matchers num entry `/vitest` separado | O exemplo da §6.9 roda como está; Jest/`node:test` ficam de fora até haver demanda |
| D53 | **O core se testa sem o kit** (detalha D22/D52): o `@zapforge/core` mantém os apoios internos de teste (`TestTransport`, `RecordingTransport`) e não depende do `@zapforge/testing`; o kit é testado contra o core real; os dois fakes seguem o mesmo contrato do `Transport` e os mesmos `assertCanSend`/`assertCapability` | Entry `@zapforge/core/testing` reexportado pelo kit; testes de ponta a ponta do `Bot` num pacote fora do core; ciclo core ↔ testing só nos testes | Sem ciclo no `tsc -b` nem mudança na API pública; ~100 linhas duplicadas entre os dois fakes |
| D54 | **Baseline do benchmark no mesmo job** (detalha D30): o job `Benchmark` faz o build do primeiro pai do commit testado num worktree, mede a base e compara (`pnpm bench --baseline`); falha com piora > 10% no sentido da meta ou fora da meta; `memory-growth` só contra a meta (`checksRegression`); cenário sem baseline passa sem comparação; o bench sobe o bot pelo entry `@zapforge/testing/bot`, sem o Vitest | Baseline versionado no repositório; baseline do último push em `develop` como artefato; meta de memória ociosa em 90 MB | Runners diferentes variam mais que 10%; nenhum arquivo de baseline para envelhecer; perto de zero, 10% do heap é ruído; os ~6 MB do Vitest não são do kernel e levavam o RSS ocioso a 80 MB no runner |
| D55 | **Plataformas-alvo e transport fora do WhatsApp antes do 1.0** (substitui parte de D03, detalha D29): alvo WhatsApp, Discord, Telegram e sistemas web próprios, sem nada de plataforma no core; um transport por `Bot` (D04), vários `Bot`s por processo; `@zapforge/transport-web` mínimo no M3 valida o contrato e o 1.0 espera um plugin portátil rodar no Baileys e no web; Telegram e Discord depois do v1.0, com mudança aditiva; transports Discord, Telegram e web públicos (Apache-2.0); comerciais de WhatsApp e integrações com sistemas do dono no privado; pontos com formato de WhatsApp resolvidos em ADRs por tema (B a F) | Manter D03 e corrigir depois do 1.0; Cloud API como segundo transport; Telegram ou Discord antes do 1.0; vários transports num `Bot` | Depois do 1.0, cada correção custa um ciclo de `@deprecated` (D27); outro WhatsApp não testa o que muda; no web o dono controla as duas pontas e roda no CI sem conta externa |
| D56 | **Owners por telefone ou por ID do contato** (detalha D24/D46): cada entrada de `owners` é telefone (string, normalizado como antes) ou `{ id }`, comparado com `sender.id`; telefone e ID nunca se cruzam | Texto livre (dígitos valem como telefone e ID); normalização do ID pelo transport | Discord, Telegram e web não têm telefone; a forma explícita não é ambígua e mantém a config atual válida |
| D57 | **`Contact` multiplataforma** (detalha D09/D38): campos opcionais `username`, `isBot` e `claims` (`Readonly<Record<string, JsonValue>>`, verificados pelo transport, só no contato que fez a ação); `phone` segue obrigatório; middleware `ignoreBots` ligado por padrão, também nos eventos `reaction` e `message.deleted` | Claims no contexto (`ctx.auth`); claims genéricos por transport; `kind` no lugar de `isBot`; `phone` opcional | No `Contact`, o claim acompanha quem age em qualquer evento; aditivo; evita loop entre bots no Discord e no Telegram |
| D58 | **`Chat` multiplataforma** (detalha D09/D24/D38): campos opcionais `kind` (`'dm' \| 'group' \| 'channel' \| 'thread'`), `parentId` (o espaço: servidor do Discord, supergrupo do Telegram) e `title`; `chat.id` opaco, composto pelo transport no tópico do Telegram; `isGroup` segue obrigatório; `chatFilter` casa `id` ou `parentId`, `block` vence | `threadId` separado no `Chat` e na `MessageKey`; ID composto com formato do core; `parentId` como pai imediato | O envio cai no tópico certo sem campo extra; admin e filtro leem o servidor direto; aditivo |
| D59 | **Grupos multiplataforma** (detalha D24/D46; substitui em parte D10/D38/D40): `transport.isChatAdmin?(chat, contact)` opcional, preferido ao `getGroupMetadata`; `participants` opcional, nunca parcial; `subject` vira `title`; `groups.admin` dá lugar a `groups.add`/`groups.remove`/`groups.promote`; eventos `group.*` com `chat: Chat` no lugar de `groupId` | Porta `isGroupAdmin` inteira no adapter; `participants` parcial documentado; `groups.admin` com `UnsupportedError` por ação; nível de admin | `group-admin` funciona sem lista de membros; falta de capability aparece no boot; `chatFilter` vê o servidor nos eventos de grupo; quebra antes do 1.0 |
| D60 | **Resposta esperada** (detalha D12/D42): `ctx.conversations.define(step, handler)` e `expectReply(step, { data, ttlMs })` no comando, no listener de mensagem e no passo; uma espera por (chat, remetente), a última substitui; consultada antes do roteador, e um comando digitado a cancela; passo com o prazo do comando e `plugin.error` `phase: 'step'`; expiração silenciosa (padrão 5 min); estado em memória, descartado no reload e no `stop()` | Storage desde já; storage + listener por plugin; comando como resposta; várias esperas; a primeira vence; qualquer pessoa do grupo; `onExpire`; "cancelar" reservado | Conversa guiada sem segurar o chat (D42) nem disputa entre plugins; restart perde a conversa; passo nomeado e `data` JSON deixam persistir depois sem mudar a API |
| D61 | **Texto formatado neutro** (detalha D09/D19): `fmt`, `bold`, `italic`, `code`, `link` e `mention` montam uma árvore congelada; texto cru continua cru; o conteúdo ganha `formatted`/`formattedCaption` opcionais com o texto visível em `text`/`caption`, e o transport que não os conhece envia o visível; o transport notifica só as menções explícitas, e a citação não pinga; `Transport.limits` (`text`, `caption`, `measure`) e a fila divide por parágrafo, linha, espaço e caractere, a parte seguinte na frente do chat, a chave da primeira; `edit` acima do limite lança `RangeError`; entrada como texto visível, sem entities | Marcadores privados; subconjunto de Markdown; `ping` no reply; dividir só no reply ou no transport; `Message.formatted`; trocar o tipo de `text` | Plugin portátil até no negrito, sem quebrar transport existente; resposta longa não vira 400; o escape fica com quem conhece a plataforma |
| D62 | **Ações e botões** (detalha D12/D49/D60): `ctx.reply(text, { actions })` com `{ label, command, args? }` ou `{ label, step, data? }`; o clique passa pela fila e pelos middlewares e roda o mesmo comando, com papel, recusa e evento `command`, ou o passo do plugin; o botão leva um ID opaco de 16 caracteres preso ao chat, guardado em memória por 24 h (no máximo 10.000, sem timer), e sobrevive ao reload; clique vencido ou forjado é descartado com log em `debug`; capability `actions`, `SendOptions.actions`, `limits.actions` e evento `interaction` (do kernel, fora dos `BotEvents`); sem a capability ou acima do limite, menu em texto numerado com resposta esperada do remetente; botões só na última parte; a confirmação da interação é do transport | Comando e args assinados (HMAC); evento `interaction` livre no barramento; cada plugin mapeia o clique; ações no `ctx.send`; aviso do kernel no clique vencido | Botão que o cliente não forja; um comando serve para texto e para botão; o Baileys continua usável pelo número |
| D63 | **Prefixo por chat** (detalha D12/D60): `prefix` aceita um texto ou `{ dm, group }` (`group` = todo chat que não é `dm`), padrão `'!'`; vazio permitido, com a primeira palavra como token; override por chat em `ctx.prefixes` (`get`, `set`, `reset`), gravado em `$prefixes` e lido inteiro no boot; prefixo começado por espaço lança `TypeError`; o roteador tira `@<self.username>` do token (`/cmd@Bot` do Telegram); um comando digitado continua cancelando a espera | Vários prefixos ao mesmo tempo; `message.command` vindo do transport; `ctx.chat.setPrefix`; override lido do storage a cada mensagem ou por chat; espera que vence o comando com prefixo vazio | Comando de grupo do Telegram funciona; chatbot do web sem prefixo; caminho quente sem I/O |
| D64 | **Comandos nativos** (detalha D37/D42/D62): `TransportDeps.commands` opcional com `list()` (`CommandInfo`) e `onChange()`; aviso em lote ao fim de cada reload e uma vez por tick para o `add` fora dele, nunca no boot nem a partir do `stop()`; o transport compara antes de registrar; menu só com o `name`, `role` decide quem vê (`owner` e custom fora); comando nativo pelo `interaction` com `command` e `args` em texto livre, rodando como o digitado sem prefixo; o transport confirma na hora e responde como follow-up; filas e ADR 0042 sem mudança | Lista lida só no `connect()`; `Transport.setCommands?()`; `message` com `<prefixo>nome args`; evento `command.invoked`; menu com todos os comandos; core filtrando só `everyone`; schema tipado de argumentos já na v1 | Menu nativo atualizado no reload sem estourar a taxa da plataforma; slash command funciona com qualquer prefixo |
| D65 | **Vários anexos e álbum** (detalha D09/D10/D61): `Message.attachments` em toda mensagem (vazio sem mídia), `media` = `attachments[0]`; `type` é o do primeiro anexo, e `accepts`/`ctx.media` não mudam; `Media.fileName` opcional; o álbum do Telegram é juntado no transport; envio com `{ type: 'album', items, caption? }` (itens `image`/`video`/`document`) e `ctx.reply.album`; capability `send.album`, e sem ela a fila envia item a item, legenda no primeiro; `limits.album` divide em lotes, lote de um vira mensagem comum; o que a plataforma não aceita junto é do transport | `media` como array; `attachments` só nos tipos de mídia; tipo `mixed`; `mediaGroupId` para o plugin juntar; álbum exigindo a capability; só entrada; `accepts` procurando em todos os anexos | Nenhum anexo some na entrada; plugin envia vários arquivos em qualquer transport sem fallback próprio |
| D66 | **Objeto bruto da mensagem** (detalha D11/D03): `ctx.unsafe.raw(message)` devolve o objeto de onde a mensagem saiu, `unknown`, ou `undefined` se o transport não o expõe ou a mensagem não veio dele; mesmas regras do `native` (sem bloqueio, `warn` uma vez por plugin, à parte do `native`); `Transport.raw?(source: Message \| Interaction)` opcional, com `WeakMap` na instância do transport; a mensagem de clique ou comando nativo pergunta pela `Interaction`, por um `WeakMap` do `Bot`; busca por identidade; kit com `setRaw` e `raw` no `receive()`/`click()` | `WeakMap` no core via `createMessage({ raw })`; campo `Symbol` na `Message`; `native` na `MessageKey`; genérico por transport no `Unsafe`; só `Message`, sem interação | Plugin específico de plataforma usa o que o contrato não representa, inclusive na interação; core sem custo por mensagem |
| D67 | **Janela da plataforma no retry e ritmo do transport** (detalha D19/D39/D47): erro do transport com `retryAfterMs` (duck typing, como `retryable`) re-tenta depois dessa janela exata, no lugar do backoff, contando em `maxAttempts`; `retryAfterScope: 'global'` segura todos os chats até a janela, mesmo sem re-tentar; janela acima de `retry.maxDelayMs` rejeita sem re-tentar; fora do `sendTimeoutMs` e do prazo do handler; mapeamento de 4xx para `retryable: false` documentado; `Transport.pacing` opcional dá o ritmo padrão, com a config do bot sobrescrevendo campo a campo e o padrão do core mantido | Classe `RateLimitError` no core; core lendo `retry_after`/status HTTP; janela sem teto; janela longa via `maxPauseMs`; janela global só no envio que re-tenta; `chatIntervalMs` por tipo de `Chat`; transport sobrescrevendo a config | 429 não perde a resposta nem faz os outros chats baterem na plataforma; cada transport traz o ritmo da plataforma sem o app saber dele |
| D68 | **Desconexão fatal e transport sem pareamento** (detalha D03/D13/D45/D48): `DisconnectReason` ganha `fatal` (erro de configuração: token sem permissão, intents, porta), decisão `stop` com causa `fatal`; capability `pairing` (QR ou código), e sem ela `auth-failed` decide `stop` (causa `auth-failed`) em vez de `clean-session`; `ReconnectionPolicyOptions.pairing` (padrão `true`), preenchida pelo `Bot` a partir da capability; `fatal` e `auth-failed` sem pareamento logam em `fatal`, o `closed` chega aos listeners antes do `stop()` e o código de saída é do app; adapter sobre lib que se reconecta sozinha só emite `closed` na queda terminal; o Baileys declara `pairing` | `Transport.pairing?` com ausente = pareia; `auth-failed` sempre para; `logged-out`/`qr-limit` também param; motivo `rate-limited`; `process.exit` no core; evento `bot.stopped` | Token inválido para o bot com uma linha em `fatal` em vez de limpar a sessão a cada minuto para sempre; WhatsApp segue pareando de novo sozinho |
| D69 | **Uniões de tipo antes do 1.0** (detalha D09/D10/D27): `MessageType`, `Message` e `OutgoingContent` seguem uniões fechadas; acrescentar membro é minor, também depois do 1.0, se na entrada o caso chegava como `unknown` e na saída vier com capability nova; plugin e transport tratam `unknown` e usam `default` no `switch`, nunca o `never` exaustivo; GIF (`animation`, `gifPlayback`) e recado de vídeo (`video_note`, `ptv`) chegam como `video`, `venue` como `location` com `address?` novo; `dice`/`game`/`invoice`/`story` e mensagem só com embed ficam `unknown` + `ctx.unsafe.raw`; `isViewOnce`/`isForwarded` seguem `boolean` (`false` fora do WhatsApp); `sticker` segue atrás de `send.sticker`; `card` fica para o `transport-web` | Uniões abertas (`string & {}`, perde o narrowing); tipos `animation`/`videoNote`; só capability e raw, sem política; `isViewOnce` opcional; `card` agora | Contrato sem formato de WhatsApp nos tipos, e as adições futuras não exigem major |
| D70 | **Capabilities multiplataforma** (detalha D10/D16): `presence` vira `typing`, com `sendTyping(chatId, 'text' \| 'voice')` e `ctx.send.typing`, sem status online nem `paused`; a sessão tem uma reação por mensagem (`react` substitui, `null` remove a da sessão), e emoji recusado rejeita com `retryable: false`; enquete com `multiple?: boolean` no lugar de `selectableCount`, voto em issue própria; a lista é só a do core, sem namespace de fornecedor; limites em `Transport.limits`; apagar mensagem de outros sem capability nova; §6.10 vira matriz por transport | Manter `presence` estreitando o tipo; `typing` ao lado de `presence`; `unreact(key, emoji)`; manter `selectableCount`; evento de voto já; namespace `x-<transport>.*` | `presence` misturava status global com "digitando"; Telegram e Discord não contam opções nem param o indicador; o `transports` do manifesto já cobre o plugin específico |
| D71 | **Voto em enquete** (completa D70, segue D38): evento `poll.vote` com `{ chat, messageId, sender, options, fromMe }`, `options` = índices da escolha inteira (`[]` = retirado); `chatFilter`/`ignoreSelf`/`ignoreBots` como na reação; o Baileys guarda em memória (até 1000, limpo no `disconnect()`) as enquetes vistas e decifra o voto tentando os pares telefone/LID | Opções por texto; diferença `added`/`removed`; enquetes no storage; capability `polls.votes` | Telegram e Discord só mandam o ID da opção; WhatsApp e Telegram mandam a escolha inteira; o Baileys 7 não decifra mais o voto |
| D72 | **Isolamento automático por tenant** (detalha D36/D15): `Chat.tenantId?` verificado pelo transport, que compõe o tenant no `chat.id` e nos IDs de contato; um `AsyncLocalStorage` por bot roda cada mensagem e evento no escopo do tenant, e o mesmo `ctx.storage` grava em `<plugin>@<tenant>` (handler, closure do `setup`, service de outro plugin, timer); sem tenant, escopo da sessão (compartilhado); `ctx.storage.forTenant(id)` de qualquer lugar; job guarda o tenant de origem | Campo `storage` só no handler; tenant como sessão lógica; plugin filtra; `tenantId` na `Message` ou no `Contact`; recusar storage sem tenant; `forTenant` só fora de handler | Um plugin que esquece de filtrar vazaria dados de uma escola para outra; o handler usa o `ctx.storage` do `setup` por closure |
| D73 | **Kit de testes multiplataforma** (detalha D52/D22): `PROFILES` no `@zapforge/testing` (`whatsapp`, `telegram`, `discord`, `web`) com capabilities, `limits` e contatos `self`/`sender` da plataforma, tirados da §6.10; `whatsapp` = o que o Baileys declara, conferido por teste no transport; `new FakeTransport({ profile })` e `createTestBot({ profile })`; sem perfil, nada muda; contador de IDs por `TestBot`; matriz por `describe.each(PROFILE_NAMES)` | Perfil em cada transport; perfil sem teste de sincronia; perfil só com capabilities; padrão = `whatsapp` ou remetente sem telefone; helper `forEachProfile` | Um plugin passava no kit com todas as capabilities e era recusado no boot no Telegram, no Discord ou no web |
| D74 | **Trava de sessão entre processos** (detalha D36/D14): `acquireLease?`/`releaseLease?` no `StoragePort`, atômicas e com a validade medida pelo adapter; opcionais só para storage de um processo (a suíte de contrato cobra, salvo `processLocal`); o bot trava `session:<sessão>` no `start()` por 30 s e renova a cada 10 s; ocupada, espera até uma validade e falha com `BotConfigError`; perdida, para o bot; o `stop()` libera; por nome de sessão, sem olhar o transport | CAS genérico no KV; trava obrigatória também na memória; falhar o `start()` na hora; seguir com a trava perdida; transport no namespace; só documentar | O Discord aceita o mesmo token em vários gateways e o web não derruba a conexão antiga: dois processos responderiam em dobro |
| D75 | **Vários bots num storage e escopo compartilhado** (detalha D04, substitui o "fora da v1" do D36): um transport por `Bot`, vários bots por processo com a mesma instância de storage; `ctx.storage.shared` em `$shared:<plugin>`, comum às sessões e só do plugin, seguindo o tenant (`@<tenant>`, `forTenant`); `ctx.transportName` para compor chaves de ID; sem transação nova; HTTP (#120) com um servidor por processo, detalhado no ADR dele | Escopo nomeado entre plugins; opção no `createBot`; `shared` sem tenant; kernel prefixar chaves; hub de processo; multi-transport num bot | Plugin não dividia dados entre plataformas; IDs só são únicos dentro do transport |
| D76 | **HTTP do core** (detalha D20/D37/D75): `createHttp({ port })` passado em `BotConfig.http`, a mesma instância para todos os bots; porta só abre com rota, depois do `setup` e antes do `connect()`, e fecha com o último bot; `/plugins/<nome>` e `/transports/<name>` na sessão `default`, sob `/sessions/<sessão>` nas outras; `ctx.http` e `TransportDeps.http` com `route(method, path, (Request, { params }) => Response)` e `ws(path, accept)` da Web API, sem tipo do Hono; erro de rota de plugin em `plugin.error` (`phase: 'http'`); `/health` 200/503 pelo estado das sessões; sem auth, prazo ou tenant no kernel | Opções por bot; servidor padrão implícito; sessão em todo caminho; prefixo só com dois bots; `Context` do Hono; `/health` mínimo | Webhooks de transport e dashboard numa porta só, com vários bots; contrato neutro antes do 1.0 |

---

## 5. Arquitetura

### 5.1 Layout do monorepo

```
zapforge/
├── packages/
│   ├── core/                 # @zapforge/core — o kernel
│   ├── transport-baileys/    # @zapforge/transport-baileys
│   ├── transport-web/        # @zapforge/transport-web (M3, D55)
│   ├── transport-telegram/   # @zapforge/transport-telegram (pós-v1)
│   ├── transport-discord/    # @zapforge/transport-discord (pós-v1)
│   ├── storage-sqlite/       # @zapforge/storage-sqlite (padrão)
│   ├── storage-postgres/     # @zapforge/storage-postgres
│   ├── testing/              # @zapforge/testing — FakeTransport, createTestBot, matchers
│   └── create-plugin/        # create-zapforge-plugin — scaffold
├── plugins/                  # plugins oficiais (públicos)
│   ├── help/  everyone/  user-names/  media/  download/
│   ├── reminders/  rank/  ai/  dashboard/
├── apps/
│   └── lumabot/              # app de referência: config + seleção de plugins
├── legacy/                   # LumaBot atual (MIT), em produção até a paridade
├── bench/                    # benchmarks do CI
└── docs/
    ├── adr/                  # D01–D31
    ├── guides/               # "primeiro plugin em 5 minutos", etc.
    └── api/                  # TypeDoc gerado
```

### 5.2 O que é core × plugin

**Core (`@zapforge/core`)**

| Componente | Responsabilidade |
|---|---|
| `Bot` | Instância raiz; dona de todo o estado; `start()`/`stop()` |
| Connection lifecycle | QR, pairing code, reconexão via policy (decisão separada da execução) |
| `Transport` (interface) | Contrato + capabilities; adapters em pacotes separados |
| Modelo de mensagem | Union discriminada, quoted, mentions, mídia lazy com cache |
| Fila de entrada | Por chat (serializa mesmo chat, paraleliza chats distintos) |
| Pipeline | Middlewares onion → comandos → listeners paralelos com `claim()` |
| Comandos | Declarativos: nome, aliases, prefixo configurável, `accepts`, `role`, parse de args |
| Barramento de eventos | Tipado; filtros declarativos (`message:image`, `{ quoted: 'audio' }`) |
| Lifecycle de plugins | Loader (npm + pasta), validação de manifesto, ordenação, `setup`/`teardown`, isolamento e timeout, tabela de boot |
| Service registry | `provides` / `ctx.services.get` |
| `StoragePort` | KV com namespace + coleções; auth state |
| Scheduler | Jobs persistidos no storage (um loop só para todo o bot) |
| Fila de saída | Rate global/por chat, prioridade, retry, humanização opcional |
| Config | Zod por plugin, precedência, secrets, reload de plugin |
| Papéis | owner / group-admin / everyone; middleware de allow/blocklist |
| HTTP | Hono sob demanda, `/health`, rotas namespaced |
| Logger | pino estruturado com `plugin` no contexto |

**Plugins oficiais**: help (gerado a partir dos comandos registrados), everyone (`@todos`),
user-names (resolução JID → nome/nick, provê service), media (sticker/imagem/GIF/PDF), download
(vídeo/áudio), reminders (usa o Scheduler), rank, ai (Luma: IA, personas, tools, histórico,
resumo, spontaneous, transcrição) e dashboard.

### 5.3 Fluxo de uma mensagem

```
Transport (Baileys, web...) ── evento bruto
        │
   normaliza → Message (union discriminada)
        │
   Fila de entrada por chat
        │
   Middlewares (onion, por prioridade)      ← ignore-self, rate limit, allow/blocklist,
        │                                     sanitização (middlewares do app)...
   Comando casou? (token inicial exato)
     ├─ sim → valida role (inclui papéis custom, D35) + accepts → run()  → mensagem consumida
     └─ não → listeners em paralelo (try/catch + timeout cada)
                 └─ ctx.claim() sinaliza "já respondi" aos de menor prioridade
        │
   ctx.reply()/send → Fila de saída (rate, prioridade, retry) → Transport
```

### 5.4 Regras de dependência

- `core` não importa nenhum transport, storage concreto nem plugin.
- Transports e storages dependem apenas de `core` (interfaces).
- Plugins dependem apenas da API pública de `core` (e de services de outros plugins via `dependsOn`).
- `apps/lumabot` só compõe: config + lista de plugins.
- Nenhum módulo tem side effect em import (abrir banco, ler env, criar diretório).

---

## 6. API pública (esboços)

> Esboços para orientar o design — nomes finais serão definidos nas issues do M1.

### 6.1 Composição do bot

O ZapForge é uma biblioteca (D34): o app importa o core, compõe o bot e cuida do processo. Não
há runner nem arquivo de config descoberto por convenção.

```ts
// apps/lumabot/src/main.ts
import { createBot } from '@zapforge/core';
import { baileys } from '@zapforge/transport-baileys';
import { sqlite } from '@zapforge/storage-sqlite';
import { sticker } from '@zapforge/plugin-media';
import { ai } from '@zapforge/plugin-ai';

const bot = createBot({
  session: 'principal',                           // padrão 'default' (D36)
  transport: baileys({ pairing: 'qr' }),          // fábrica: recebe auth state e logger do bot (D37)
  storage: sqlite({ path: './data/bot.sqlite' }),
  owners: ['5511999999999'],
  prefix: '!',
  plugins: [sticker(), ai({ provider: 'gemini' })],
  pluginDirs: ['./plugins'],
  disabledPlugins: [],
  pluginConfig: { sticker: { quality: 90 } },     // env ZAPFORGE_STICKER__QUALITY vence (D32)
});

await bot.start();
process.once('SIGTERM', () => void bot.stop());
```

### 6.2 Definição de plugin (manifesto)

```ts
import { definePlugin, command } from '@zapforge/core';
import { z } from 'zod';

export const sticker = definePlugin({
  name: 'sticker',
  version: '1.2.0',
  engine: '^1.0.0',                              // semver do @zapforge/core
  requires: ['media.download', 'send.sticker'],  // capabilities do transporte
  transports: undefined,                         // opcional: fixa runner(s)
  dependsOn: { 'user-names': '^1.0.0' },         // opcional
  priority: 0,                                   // ou after: ['outro-plugin']

  config: z.object({
    quality: z.number().min(1).max(100).default(80),
  }),

  messages: {                                    // sobrescrevível via config (D25)
    needMedia: 'Mande ou responda uma imagem/vídeo 🙂',
  },

  setup(ctx) {
    ctx.commands.add(command({
      name: 'sticker', aliases: ['s'],
      accepts: ['image', 'video', 'quoted:image', 'quoted:video'],
      onReject: (c) => c.plugin.messages.needMedia,
      role: 'everyone',
      run: async (c) => {
        const buf = await c.media!.download();   // própria msg OU quoted, já resolvido
        await c.reply.sticker(buf);
      },
    }));
  },

  teardown(ctx) { /* libera recursos */ },
});
```

### 6.3 Modelo de mensagem

```ts
bot.on('message', async (ctx) => {
  const msg = ctx.message;
  msg.type   // 'text' | 'image' | 'video' | 'audio' | 'voice' | 'sticker'
             // | 'document' | 'location' | 'contact' | 'poll' | 'unknown'
  msg.text   // texto ou legenda; null se não houver
  msg.chat   // { id, isGroup }
  msg.sender // Contact

  if (msg.is('image')) {
    msg.media.mimetype; msg.media.size;
    await msg.media.download();  // Buffer, lazy + cache por mensagem
    await msg.media.stream();    // para arquivos grandes
  }

  msg.quoted                     // Message | null (mesmo tipo, recursivo)
  msg.mentions                   // Contact[]
  msg.isForwarded; msg.isViewOnce; msg.isEdited
});

bot.on('message:image', handler);
bot.on('message', { quoted: 'audio' }, handler);
```

### 6.4 Eventos

`message`, `message:<type>`, `message.edited`, `message.deleted`, `reaction`, `poll.vote` (D71),
`group.joined`, `group.left`, `group.participants`, `group.updated`,
`contact.updated` (D40), `connection.status`, `connection.qr`, `connection.pairing-code` (D50),
`command` (D49), `plugin.error`.

### 6.5 Contexto, claim e escape hatch

```ts
bot.on('message', { priority: -10 }, async (ctx) => {
  if (ctx.claimed) return;          // alguém de maior prioridade já respondeu
  ctx.claim();
  await ctx.reply('...');
});

ctx.unsafe.native                   // unknown; loga aviso; implica transports: ['baileys']

// Prazo (D33): o signal aborta quando o prazo do comando/listener/job estoura
run: async (c) => {
  const res = await fetch(url, { signal: c.signal });
  await c.reply(await res.text());  // depois do prazo: rejeita com ContextExpiredError
}
```

### 6.6 Storage

```ts
await ctx.storage.kv.set('lastRun', Date.now());
const reminders = ctx.storage.collection('reminders', { indexes: ['fireAt', 'chatId'] });
await reminders.insert({ chatId, fireAt, text });
await reminders.find({ where: { fireAt: { lte: Date.now() } }, orderBy: 'fireAt', limit: 50 });
```

### 6.7 Services entre plugins

```ts
// plugin 'ai'
definePlugin({ name: 'ai', setup(ctx) { ctx.services.provide('ai', aiService); } });

// declaration merging para tipagem
declare module '@zapforge/core' {
  interface Services { ai: AiService }
}

// plugin 'resumo'
definePlugin({ name: 'resumo', dependsOn: { ai: '^1.0.0' },
  setup(ctx) { const ai = ctx.services.get('ai'); } });
```

### 6.8 Scheduler, HTTP e papéis

```ts
ctx.scheduler.at(date, 'reminder.fire', payload);    // persistido
ctx.scheduler.on('reminder.fire', async (payload) => { ... });

ctx.http.route('POST', '/webhook', handler);          // → /plugins/<name>/webhook

command({ name: 'config', role: 'owner', run });
command({ name: 'ban', role: 'group-admin', run });   // requer capability 'groups'

// Papel custom (D35): definido por um plugin, usado por qualquer outro
ctx.roles.define('moderador', async (c) => moderadores.has(c.message.sender.id));
command({ name: 'mute', role: 'moderador', run });
```

### 6.9 Testes de plugin

```ts
import { createTestBot } from '@zapforge/testing';

const bot = await createTestBot({ plugins: [sticker()] });
await bot.receive({ text: '!s', image: fixtureBuffer });
expect(bot.sent).toContainSticker();
```

### 6.10 Capabilities por transport

Cada transport declara as próprias (D10). A lista é só a do core, e capability nova entra numa minor
(D70). Limites de tamanho não são capability: ficam em `Transport.limits` (D61, D65). A coluna do
Baileys é o que ele declara hoje; as outras são a previsão, confirmada quando cada transport nascer
(web no #287, Telegram e Discord depois do v1.0).

| Capability | Baileys | Telegram | Discord | web |
|---|---|---|---|---|
| `actions` | — | ✓ | ✓ | ✓ |
| `groups` | ✓ | ✓ | ✓ | — |
| `groups.add` | ✓ | — | — | — |
| `groups.remove` | ✓ | ✓ | ✓ | — |
| `groups.promote` | ✓ | ✓ | — | — |
| `mentions` | ✓ | ✓ | ✓ | #287 |
| `reactions` | ✓ | ✓ | ✓ | #287 |
| `typing` | ✓ | ✓ | ✓ | ✓ |
| `send.text` | ✓ | ✓ | ✓ | ✓ |
| `send.image` | ✓ | ✓ | ✓ | ✓ |
| `send.video` | ✓ | ✓ | ✓ | #287 |
| `send.audio` | ✓ | ✓ | ✓ | #287 |
| `send.voice` | ✓ | ✓ | — | — |
| `send.sticker` | ✓ | ✓ | — | — |
| `send.document` | ✓ | ✓ | ✓ | ✓ |
| `send.album` | — | ✓ | ✓ | #287 |
| `media.download` | ✓ | ✓ | ✓ | ✓ |
| `message.edit` | ✓ | ✓ | ✓ | #287 |
| `message.delete` | ✓ | ✓ | ✓ | #287 |
| `polls` | ✓ | ✓ | ✓ | — |
| `quoted` | ✓ | ✓ | ✓ | #287 |
| `pairing` | ✓ | — | — | — |

---

## 7. Metas de performance

Medidas no CI com `FakeTransport` (sem I/O de rede). PR falha se regredir mais de 10%.

| Métrica | Meta |
|---|---|
| Overhead do kernel por mensagem (middlewares + roteamento + dispatch) | p99 < 1 ms |
| Vazão sintética | ≥ 5.000 msg/s em 500 chats, 1 núcleo |
| Memória ociosa | < 80 MB |
| Crescimento de memória após 1M mensagens | ~0 (detecta vazamentos como o `rateLimiter` atual) |
| Boot até "pronto para conectar" com 20 plugins | < 500 ms |

---

## 8. Governança, licença e modelo comercial

- **Licença**: Apache-2.0 para `packages/*`, `plugins/*`, `apps/*`; `legacy/` permanece MIT.
- **Open core**: transports comerciais de WhatsApp (Cloud API, Twilio, Zenvia), dashboard
  multi-número e integrações (CRM, sistemas do dono como ERP e gestão escolar) vivem num **repo
  privado** que consome os pacotes publicados num registry privado (GitHub Packages). Se o
  privado precisar de algo não exportado, falta API no core — nunca atalho interno. Os
  transports Discord, Telegram e web são públicos, neste monorepo (D55).
- **Versionamento**: Changesets; changelog por pacote no formato Keep a Changelog.
- **Estabilidade**: `0.x` livre até a 1.0; depois, `@deprecated` por ≥ 1 minor antes de remover;
  `@experimental` para APIs novas.
- **Documentação** (por pacote): COMO em `docs/`, PORQUE em `docs/adr/`, PROGRESSO em
  `CHANGELOG.md`.
- **Convenções**: ESM, named exports apenas, imports absolutos (`@zapforge/*`), comentários em
  PT-BR explicando o porquê, nunca engolir erros, nenhum `process.env` fora da camada de config.
  Codificadas no Biome e verificadas no CI.

---

## 9. Roadmap: milestones, issues e sub-issues

Convenção: **Milestone → Issue (épico/entrega) → Sub-issues (tarefas)**. Cada issue lista
critérios de aceite. Toda issue herda os critérios gerais:

> **DoD geral**: testes verdes; nenhum teste existente apagado/reescrito sem autorização;
> docs (COMO) atualizadas; ADR quando houver decisão arquitetural; changeset criado;
> Biome sem erros; benchmark sem regressão > 10% (a partir do M2).

---

### M0 — Fundação

**Objetivo**: monorepo funcional, tooling, decisões registradas, legacy isolado e verde.

- **#M0-1 Criar monorepo**
  - Criar org `zapforge` no npm (feito em 2026-10-06); repositório fica na conta pessoal do GitHub
  - Inicializar pnpm workspaces (`packages/*`, `plugins/*`, `apps/*`)
  - `tsconfig.base.json` (strict, ESM, `NodeNext`) + project references
  - Aliases `@zapforge/*`
  - `engines: { node: ">=24" }` + `.nvmrc`
  - *Aceite*: `pnpm install && pnpm -r build` funciona num pacote vazio de exemplo
- **#M0-2 Tooling de qualidade**
  - Biome com regras: sem default export, sem `catch` vazio, sem imports relativos
    ascendentes, sem `process.env` fora da config
  - Vitest com workspace config
  - tsdown por pacote (ESM + `.d.ts`)
  - Changesets
  - *Aceite*: `pnpm lint`, `pnpm test`, `pnpm build` rodam na raiz
- **#M0-3 CI (GitHub Actions)**
  - Jobs: lint, typecheck, test, build
  - Cache do pnpm
  - Placeholder do job de benchmark (ativado no M2)
  - *Aceite*: PR de exemplo passa com todos os checks
- **#M0-4 Mover LumaBot para `legacy/`**
  - Mover código atual mantendo histórico git
  - Testes do legacy rodando no CI, **sem alteração**
  - Deploy de produção (PM2/Docker) apontando para `legacy/`
  - *Aceite*: suíte do legacy verde no CI; bot em produção inalterado
- **#M0-5 ADRs**
  - Escrever ADRs D01–D31 em `docs/adr/` + índice `docs/adr/README.md`
  - *Aceite*: um arquivo por decisão, formato Contexto/Decisão/Consequências/Status
- **#M0-6 Licença e governança**
  - `LICENSE` Apache-2.0 na raiz; `legacy/LICENSE` MIT
  - `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, templates de issue/PR
  - `CLAUDE.md` do monorepo atualizado para as novas convenções

---

### M1 — Core (`@zapforge/core`)

**Objetivo**: kernel completo testável sem transporte real.

- **#M1-1 Instância `Bot` e lifecycle**
  - `createBot(config)`, `start()`, `stop()` com shutdown gracioso
  - Nenhum estado global; nenhum side effect em import
  - *Aceite*: duas instâncias no mesmo processo não compartilham estado (teste)
- **#M1-2 Interface `Transport` e capabilities**
  - Contrato (conectar, eventos brutos → normalizados, envio, mídia, grupos)
  - Registro de capabilities; `UnsupportedError`
  - Política de reconexão (porta da `ReconnectionPolicy`: decide, não executa)
- **#M1-3 Modelo de mensagem**
  - Union discriminada (incluindo `voice` ≠ `audio`), `is()`, `quoted` recursivo, mentions, flags
  - `media.download()`/`stream()` lazy com cache por mensagem
  - *Aceite*: testes de tipo (`expectTypeOf`) garantindo narrowing
- **#M1-4 Fila de entrada por chat**
  - Porta do `JidQueue` com limite de backlog por chat e métricas
- **#M1-5 Pipeline de middlewares**
  - Onion com prioridade; middleware pode interromper
  - Middlewares oficiais: ignore-self, rate limit de entrada (com expiração), sanitização,
    allow/blocklist de chats
- **#M1-6 Roteador de comandos**
  - Prefixo configurável, aliases, match por token inicial exato, parse de args
  - `accepts` (incluindo `quoted:*`) com `ctx.media` resolvido e `onReject`
  - `role`: owner / group-admin / everyone
  - Conflito de nome/alias entre plugins = erro no boot
- **#M1-7 Barramento de eventos**
  - Eventos da seção 6.4, filtros declarativos, listeners paralelos com prioridade e `claim()`
  - Isolamento: try/catch + timeout por listener; evento `plugin.error`
- **#M1-8 Loader e lifecycle de plugins**
  - `definePlugin`; validação de manifesto (`engine`, `requires`, `transports`, `dependsOn`)
  - Fontes: lista da config (npm) + `pluginDirs`
  - Ordenação topológica (`priority`, `after`, `dependsOn`); detecção de ciclo
  - Enable/disable por nome; tabela de boot "carregado / ignorado (motivo)"
  - `setup`/`teardown` com timeout
- **#M1-9 Service registry**
  - `provide`/`get` tipados por declaration merging; erro claro se serviço ausente
- **#M1-10 `StoragePort`**
  - Interface KV com namespace por plugin + coleções (`insert`, `update`, `delete`, `find` com
    filtros/ordenação/limite, índices declarados)
  - Interface de auth state
  - Adapter em memória para testes
  - Suíte de **testes de contrato** reutilizável por qualquer adapter
- **#M1-11 Scheduler**
  - Jobs persistidos no storage; um único loop; reentrega após restart; jobs vencidos durante
    downtime
- **#M1-12 Fila de saída**
  - Taxa global e por chat, prioridade, retry com backoff, humanização opcional
  - `ctx.reply()` transparente
- **#M1-13 Config**
  - Schema Zod por plugin; precedência env > arquivo > overrides (storage) > default
  - Campos `secret` (mascarados, nunca logados)
  - Reload de plugin ao mudar config (`teardown` → `setup`)
  - Objeto `messages` sobrescrevível
  - `owners` da config do bot: telefones só com dígitos, comparados com `Contact.phone` (M1-16)
  - Convenções do D32: env `ZAPFORGE_<PLUGIN>__<CAMPO>` (colisão de nomes = erro do autor),
    `pluginConfig` como arquivo, `PluginConfigError` com campo e fonte, `secret()` só em campo de
    `z.object`, segredo recusado no override
- **#M1-14 Logger**
  - pino com `plugin` e `chatId` no contexto; nível configurável
- **#M1-15 Escape hatch**
  - `ctx.unsafe.native` com aviso no log (uma vez por plugin)
- **#M1-16 Pipeline integrado no `Bot`**
  - Fluxo da seção 5.3 dentro do `Bot`: evento `message` do transport → fila de entrada →
    middlewares → roteador → listeners (M1-7); `stop()` fecha a fila por um gancho de parada
  - Texto de trabalho `ctx.text`: preenchido pelo middleware `sanitize`, lido pelo roteador e
    pelos listeners
  - `ReconnectionPolicy` ligada a `connection.status`/`connection.qr`; o `Bot` executa a decisão
  - Owners por telefone: `Contact.phone` (só dígitos, `null` se o transport não souber); o
    roteador compara `owners` com `sender.phone`
  - Cancelamento cooperativo (D33): `signal` em comando, listener, job e `PluginContext`;
    `reply`/`send`/`storage`/`scheduler` de contexto expirado rejeitam com `ContextExpiredError`
  - *Aceite*: mensagem de um `Transport` de teste percorre os estágios até o comando ou os
    listeners (teste de ponta a ponta sem transporte real)
- **#M1-17 API pública por público** (D34)
  - `@zapforge/core` com a API de plugin e de composição do app; `@zapforge/core/adapter` para
    transports e storages; internos fora do `index.ts`
  - *Aceite*: teste que fixa a lista de exports de cada ponto de entrada
- **#M1-18 Métricas das filas no `Bot`**
  - `bot.stats()` com as métricas da fila de entrada e da fila de saída (M1-4, M1-12)
  - `bot.settled()` espera a fila de entrada, os listeners e a fila de saída esvaziarem juntos
    (D44), base do `receive()` do `@zapforge/testing` (M2-3)
- **#M1-19 Papéis custom nomeados** (D35)
  - `ctx.roles.define(nome, check)`, `role: nome` no comando, `Roles` por declaration merging
  - Avaliação no roteador com prazo e fail-closed; conflito de nome = erro no boot
- **#M1-20 Escopo de sessão** (D36)
  - `createBot({ session })` com padrão `'default'`; namespaces, jobs, overrides e auth state no
    escopo da sessão
  - Sessão repetida no mesmo storage recusada no `createBot`; `DisconnectReason` `'replaced'` sem
    reconexão
  - *Aceite*: dois bots com sessões diferentes no mesmo storage não compartilham jobs nem dados
- **#M1-21 Transport por fábrica** (D37)
  - `transport: Transport | ((deps: TransportDeps) => Transport)`, `deps` = `session`, `auth`, `log`
  - `clean-session` limpa o auth state sem `clearSession` configurado

---

### M2 — Primeiro transporte, storage e kit de testes

- **#M2-1 `@zapforge/transport-baileys`**
  - Conexão, QR e pairing code, reconexão
  - Normalização (unwrap ephemeral/viewOnce/documentWithCaption) → modelo do core, incluindo
    `Contact.phone` resolvido também para remetentes com LID (M1-16)
  - Envio de todos os tipos; mídia; grupos; reações; presença; edição/deleção
  - Declaração de capabilities (seção 6.10)
  - Auth state via `StoragePort` (substitui `useMultiFileAuthState`), recebido pela fábrica (D37)
  - Desconexão por conexão substituída mapeada para `'replaced'` (D36)
  - Mapeamento de eventos Baileys → barramento (contatos, grupos, reações, edições)
- **#M2-2 `@zapforge/storage-sqlite`**
  - Implementação KV + coleções + auth state; WAL; migrations internas do adapter
  - Passa na suíte de contrato do M1-10
- **#M2-3 `@zapforge/testing`**
  - `FakeTransport`, `createTestBot`, `bot.receive()`, `bot.sent`, matchers
    (`toContainSticker`, `toHaveReplied`...)
  - Fixtures de mídia
- **#M2-4 Benchmark**
  - Cenários da seção 7 em `bench/`; vazão com `globalIntervalMs`/`chatIntervalMs` em 0 (D47)
  - Job de CI com baseline e falha > 10%
- **#M2-5 App mínimo**
  - `apps/lumabot` conectando via Baileys + SQLite com um plugin "ping"
  - *Aceite*: responde `!ping` num número real

---

### M3 — Postgres, HTTP e experiência do autor

- **#M3-1 `@zapforge/storage-postgres`**
  - Mesma suíte de contrato; testes com Postgres em container no CI
- **#M3-2 HTTP do core**
  - Hono sob demanda; `/health`; rotas `/plugins/<name>/...` e `/transports/<name>/...`, sob
    `/sessions/<sessão>` fora da `default`; WebSocket (D76)
- **#M3-3 `create-zapforge-plugin`**
  - Template TS com manifesto, teste com `@zapforge/testing`, README, changeset
- **#M3-4 Documentação de autor**
  - Guia "seu primeiro plugin em 5 minutos"
  - Guias: comandos, eventos/mídia, storage, config, services, scheduler, capabilities,
    escape hatch, testes
  - Referência gerada por TypeDoc
  - Docs do core (COMO): visão geral, módulos, entrypoints, schemas
- **#M3-5 `@zapforge/transport-web`** (#287, D55)
  - Chatbot web com JWT do sistema de origem, claims, tenant e ações; rotas no HTTP do M3-2
  - *Aceite*: um plugin portátil roda sem mudança no Baileys e no web

---

### M4 — Port dos plugins (ordem de complexidade)

Cada plugin: código novo em `plugins/<nome>`, testes com `@zapforge/testing`, docs,
changeset, item marcado na checklist de paridade (seção 10).

- **#M4-1 `plugin-help`** — `!help`/`!menu` gerado dos comandos registrados
- **#M4-2 `plugin-everyone`** — `@everyone`/`@todos` (requer `groups`, `mentions`)
- **#M4-3 `plugin-user-names`** — resolução JID → nome/nick, `!nick`, `!apelido`;
  provê service `userNames`; enriquecimento por mensagem, contatos e metadata de grupo
- **#M4-4 `plugin-utils`** — `!meunumero`
- **#M4-5 `plugin-media`** — sticker (`!s`), imagem, GIF, PDF/merge, compressão de fotos
  (Sharp/FFmpeg)
- **#M4-6 `plugin-download`** — download de vídeo e áudio
- **#M4-7 `plugin-reminders`** — `!lembrete`, listar, cancelar (usa Scheduler)
- **#M4-8 `plugin-rank`** — `!rank` (usa coleções com ordenação)

---

### M5 — Luma e dashboard

- **#M5-1 `plugin-ai` (Luma)**
  - Providers Gemini/OpenAI/DeepSeek com fallback; provê service `ai`
  - Histórico multi-turno por chat/remetente; PromptBuilder
  - Personas (padrão + custom por chat, limite), `!persona`
  - Tool calling (porta do `ToolDispatcher` usando services/API pública, sem `socket`)
  - Busca web (Tavily / Google Grounding)
  - Transcrição de `voice`
  - `!luma clear`, `!luma stats`
- **#M5-2 `plugin-resumo`** — `!resumo` (depende de `ai`)
- **#M5-3 `plugin-spontaneous`** — interações espontâneas como listener de baixa prioridade
  respeitando `ctx.claimed`
- **#M5-4 `plugin-dashboard`**
  - Rotas/WS no HTTP do core; QR, status e logs via barramento
  - Formulários de config gerados dos schemas Zod (secrets mascarados)
  - Enable/disable de plugins; tabela de boot
  - Porta do app React atual (`legacy/dashboard/web`)
- **#M5-5 Migração de dados**
  - Script de migração dos bancos do legacy (`luma_private.sqlite`, `luma_metrics.sqlite`)
    para o storage novo (usuários, personas, lembretes, interações, métricas)
  - Migração da sessão do WhatsApp (auth) ou procedimento de re-pareamento documentado

---

### v1.0 — Virada

- **#V1-1 Checklist de paridade completa** (seção 10)
- **#V1-2 Período de produção paralela** e virada do deploy para `apps/lumabot`
- **#V1-3 Release 1.0.0** de todos os pacotes públicos via Changesets, depois do contrato
  validado pelo `transport-web` (M3-5, D55)
- **#V1-4 Remoção do `legacy/`** — **somente com autorização explícita do dono do repositório**

### Pós-v1 (repo privado / backlog)

- `@zapforge/transport-telegram` (#288) e `@zapforge/transport-discord` (#289), públicos (D55)
- Transport Cloud API (WhatsApp oficial, privado): templates, janela de 24h
- Transports Twilio e Zenvia (privados)
- Dashboard central multi-número (lendo do Postgres)
- i18n formal (`ctx.t()`)
- Permissões declarativas de plugin (se houver marketplace público)
- Multi-sessão por processo

---

## 10. Checklist de paridade com o legacy

Levantada do LumaBot v1.5.0 (`src/config/constants.js`, plugins e docs). Revisar no M0.

| Funcionalidade legacy | Plugin novo |
|---|---|
| `!sticker` / `!s` (imagem/vídeo/link → figurinha) | media |
| `!image` / `!i` (figurinha → imagem) | media |
| `!gif` / `!g` (figurinha animada → GIF) | media |
| `!pdf` (imagem → PDF, com nome opcional) | media |
| `!mergepdf` / `!joinpdf` (acumula PDFs; `done <nome>`; `clear`) | media |
| Compressão de fotos (PR #28) | media |
| `!download` / `!d` (vídeo Twitter/X, Instagram) | download |
| `!audio` / `!a` (MP3 de qualquer link, yt-dlp) | download |
| `@everyone` / `@todos` | everyone |
| `!help` / `!menu` | help |
| `!meunumero` | utils |
| `!nick Nome`, `!nick @pessoa Nome`, `!apelido` | user-names |
| Enriquecimento de usuários (pushName, contatos, LID) | user-names |
| `!lembrete` / `!lembrar`, `!lembretes`, `!cancelarlembrete <n>` + disparo agendado com menção | reminders |
| `!rank`, `!rank global` | rank |
| `!resumo [n]` | resumo |
| IA em PV, quando citada ou por trigger ("Luma, ...") | ai |
| Personas: `!persona` (menu pN), `!persona criar <descrição>`, `!persona deletar pN`, limite 10 por chat | ai |
| Contexto multi-turno | ai |
| Tool calling (sticker, @todos, lembrete etc. pela IA) | ai |
| Busca web (Tavily / Google Grounding) | ai |
| Transcrição de áudio | ai |
| `!luma clear` / `!lc` / `!clear`, `!luma stats` / `!ls` | ai |
| Textos de UI customizáveis via overrides (`ConfigStore`) | core (config `messages`) |
| Interações espontâneas em grupo | spontaneous |
| Dashboard: QR, status, logs, config, deploy | dashboard |
| Rate limit de entrada, ignorar a si mesmo, sanitização | core (middlewares) |
| Reconexão automática | core + transport-baileys |

---

## 11. Fora de escopo da v1

- Hot-reload de código de plugin (D08)
- Worker threads / sandbox de plugins (D05)
- Multi-sessão por processo (D04)
- Transports além do Baileys e do web (D55): Telegram e Discord públicos, Cloud API, Twilio e
  Zenvia no repo privado
- i18n formal (D25)
- SQL cru na API pública de storage (D15)
- Marketplace de plugins

---

## 12. Sugestão de organização do GitHub Project

- **Milestones**: `M0 Fundação`, `M1 Core`, `M2 Baileys + SQLite + Testing`,
  `M3 Postgres + HTTP + DX`, `M4 Plugins`, `M5 Luma + Dashboard`, `v1.0 Virada`.
- **Issues**: uma por item `#Mx-y` acima (épico/entrega), com os critérios de aceite.
- **Sub-issues**: os bullets dentro de cada item.
- **Labels**:
  - Área: `area:core`, `area:transport`, `area:storage`, `area:plugin`, `area:dx`,
    `area:docs`, `area:infra`, `area:legacy`
  - Tipo: `type:feature`, `type:debt`, `type:adr`, `type:bug`, `type:perf`
  - Outros: `good first issue`, `breaking`, `needs-adr`
- **Campos customizados** (Project v2): `Milestone`, `Pacote`, `Estimativa`, `Status`
  (Backlog → Ready → In progress → Review → Done).
- **Dependências**: M1 bloqueia M2; M1-7 bloqueia o estágio de listeners do M1-16; M2-3 (`testing`) bloqueia M4; M1-9 (services) e
  M4-3 (`user-names`) bloqueiam M5-1.
