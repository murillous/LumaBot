# Visão geral do core

Como as peças do `@zapforge/core` se ligam. Cada seção aponta para o guia do módulo, onde está o
detalhe; o porquê está nos [ADRs](../../../docs/adr/README.md).

## O que o core é

Uma biblioteca, não um runner ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)): o
app importa `createBot`, passa transport, storage e plugins, e chama `start()`. Importar o core
não tem efeito colateral: nada conecta, agenda timer ou cria logger antes do `start()`.

Três públicos, três pontos de entrada ([README](README.md#pontos-de-entrada)):

| Quem | Escreve | Importa de |
| --- | --- | --- |
| Autor de app | a composição: `createBot`, `createHttp`, middlewares, logger | `@zapforge/core` |
| Autor de plugin | `definePlugin`, comandos, listeners, jobs | `@zapforge/core` |
| Autor de transport ou storage | o adapter de uma plataforma ou de um banco | `@zapforge/core/adapter` e `@zapforge/core/storage-contract` |

## As peças

```
plataforma ⇄ Transport ──► fila de entrada ──► middlewares ──► conversas ──► roteador ──► barramento
                            (por chat)          (onion)        (expectReply)  (comandos)   (listeners)

plugins ──► PluginContext ──► storage · scheduler · services · http · groups · send

ctx.reply / ctx.send / ações ──► fila de saída ──► Transport ──► plataforma

Em volta, por bot: logger, config de plugin, reconexão, trava da sessão.
Fora do bot: StoragePort (sqlite, postgres, memória) e HttpServer (um por processo).
```

- **Transport** fala com a plataforma (WhatsApp, Discord, Telegram, web). Emite eventos
  (`message`, `reaction`, `connection.status`...) já no modelo neutro do core e envia o que a fila
  de saída manda. Declara suas `capabilities`. → [Transport](transport.md)
- **Fila de entrada** processa as mensagens de um chat em série e chats diferentes em paralelo.
  → [Fila de entrada](inbound-queue.md)
- **Middlewares** envolvem o tratamento de cada mensagem (onion, por prioridade); podem barrá-la.
  → [Middlewares](middleware.md)
- **Conversas** entregam a resposta que um plugin pediu com `expectReply` ao passo dele.
  → [Conversas](conversations.md)
- **Roteador** casa o texto com um comando, confere papel e `accepts`, e roda o `run`.
  → [Comandos](commands.md)
- **Barramento** entrega a mensagem e os demais eventos aos listeners, em paralelo, com `claim()`.
  → [Eventos](events.md)
- **Fila de saída** é o único caminho até o transport: taxa global e por chat, prioridade,
  retry, divisão de texto longo, pausa com a conexão caída. → [Fila de saída](outbound-queue.md)
- **Host de plugins** carrega, ordena, faz `setup`/`teardown`/reload e monta a tabela de boot.
  → [Plugins](plugins.md)
- **Storage** guarda KV e coleções por plugin, jobs, overrides de config e o auth state do
  transport, atrás de um `StoragePort`. → [Storage](storage.md)
- **Scheduler** persiste jobs no storage e os dispara, inclusive os vencidos durante o downtime.
  → [Scheduler](scheduler.md)
- **Services** ligam plugins entre si por nome, tipados. → [Services](services.md)
- **HTTP** é um servidor do processo, dividido pelos bots; cada plugin e transport ganha suas
  rotas e WebSockets. → [HTTP e WebSocket](http.md)
- **Config de plugin** junta env, arquivo, overrides e defaults sob o schema Zod do plugin.
  → [Config](config.md)
- **Logger** é estruturado, com `plugin` e `chatId` no contexto e segredos censurados.
  → [Logger](logger.md)

O caminho completo de uma mensagem, com prazos e erros de cada etapa, está em
[Bot → Fluxo de uma mensagem](bot.md#fluxo-de-uma-mensagem).

## Escopos

O que vale para onde, de fora para dentro:

| Escopo | O que fica nele | Guia |
| --- | --- | --- |
| Processo | O `HttpServer` (`createHttp`), dividido por todos os bots; nada mais é global ([ADR 0004](../../../docs/adr/0004-uma-sessao-por-processo.md)) | [HTTP](http.md) |
| Bot (sessão) | Filas, barramento, roteador, host de plugins, scheduler, logger. Tudo o que persiste fica sob o nome da sessão, e uma trava impede dois processos na mesma sessão | [Bot → Sessão](bot.md#sessão) |
| Plugin | Namespace de storage, rotas `/plugins/<nome>`, comandos, listeners e jobs registrados pelo contexto, desfeitos no `teardown`/reload | [Plugins](plugins.md) |
| Tenant | Com `chat.tenantId`, o `ctx.storage` do plugin vai ao namespace do tenant em tudo o que o handler dispara | [Storage → Tenants](storage.md#tenants) |
| Execução | Cada comando, listener, passo e job tem prazo e `signal`; estourado, o contexto dele recusa novos efeitos | [Bot → Prazos](bot.md#prazos-e-cancelamento-ctxsignal) |

## Regras que atravessam tudo

- **O plugin só age pelo contexto.** Tudo o que ele registra (comando, listener, job, rota,
  service, papel) passa pelo `PluginContext` e sai no `teardown`, no reload ou na falha do
  `setup`. Plugins não importam peças internas do core.
- **Tudo o que sai passa pela fila de saída.** `ctx.reply`, `ctx.send`, ações (`react`, `edit`,
  `delete`, `typing`) e alterações de grupo; leituras (metadados de grupo) vão direto ao transport.
- **Erro de plugin não derruba o bot.** Exceção ou prazo estourado em comando, listener, passo,
  job ou rota vira `plugin.error` e uma linha de log; o chat segue. Erro de manifesto, conflito
  de nomes ou ciclo de dependências derruba o boot, antes de o transport conectar.
- **Capabilities decidem o que roda.** O plugin declara em `requires` o que é essencial (sem ele,
  não carrega) e confere o opcional em `ctx.capabilities`. Uso de capability ausente lança
  `UnsupportedError`. → [Transport → Capabilities](transport.md#capabilities)
- **O modelo é neutro.** `Message`, `Contact` e `Chat` são os mesmos em toda plataforma; o objeto
  bruto da plataforma fica atrás de `ctx.unsafe`. → [Modelo de mensagem](message.md),
  [Escape hatch](unsafe.md)

## Módulos

Cada pasta de `src/`, o que faz e se sai na API pública. "Interno" quer dizer que o módulo existe
só dentro do core: o plugin o alcança pelo contexto, nunca por import.

| Pasta | O que faz | Entrada | Guia |
| --- | --- | --- | --- |
| `bot/` | `createBot`: compõe as peças, boot, shutdown, reconexão, sessão e trava entre processos; fábrica dos contextos de mensagem e de plugin | `@zapforge/core` | [Bot](bot.md) |
| `transport/` | Contrato `Transport`, `defineTransport`, capabilities, `TypedEmitter`, política de reconexão | ambas | [Transport](transport.md) |
| `message/` | Modelo `Message`/`Contact`/`Chat`/`Media`; `createMessage` e `createMedia` para transports | tipos no core, construtores no adapter | [Modelo de mensagem](message.md) |
| `queue/` | Fila de entrada por chat | interno (só `InboundQueueStats`) | [Fila de entrada](inbound-queue.md) |
| `middleware/` | Pipeline e os middlewares oficiais (`ignoreSelf`, `ignoreBots`, `chatFilter`, `rateLimit`, `sanitize`) | `@zapforge/core` | [Middlewares](middleware.md) |
| `commands/` | `command()`, roteador, prefixos, papéis, argumentos | `@zapforge/core` (roteador interno) | [Comandos](commands.md) |
| `conversations/` | Resposta esperada (`expectReply`, passos) | `@zapforge/core` (tipos) | [Conversas](conversations.md) |
| `actions/` | Botões que rodam comando ou passo; menu numerado sem botões | `@zapforge/core` (tipos) | [Ações e botões](actions.md) |
| `events/` | Barramento: eventos, filtros, prioridade, `claim()`, isolamento | `@zapforge/core` (tipos) | [Eventos](events.md) |
| `outbound/` | Fila de saída, `ctx.reply`, envio, álbum, divisão de texto | `@zapforge/core` (tipos e erros) | [Fila de saída](outbound-queue.md) |
| `text/` | Texto formatado neutro (`fmt`, `bold`, `mention`...) e divisão do texto longo | `@zapforge/core` | [Texto formatado](text.md) |
| `plugin/` | `definePlugin`, validação do manifesto, ordem, host, tabela de boot, forma curta | `@zapforge/core` | [Plugins](plugins.md) |
| `config/` | Config de plugin (Zod, env, arquivo, overrides, segredos) e `owners` | `@zapforge/core` | [Config](config.md) |
| `storage/` | `StoragePort`, namespaces de sessão, plugin e tenant, adapter em memória, normalização de consultas, suíte de contrato | as três | [Storage](storage.md) |
| `tenant/` | Escopo de tenant do bot, que o storage do plugin lê | interno | [Storage → Tenants](storage.md#tenants) |
| `scheduler/` | Jobs persistidos com `at`/`on`/`cancel` | `@zapforge/core` (tipos) | [Scheduler](scheduler.md) |
| `services/` | Registry de services entre plugins | `@zapforge/core` (tipos e erros) | [Services](services.md) |
| `groups/` | `ctx.groups`: metadados e participantes de grupo | `@zapforge/core` (tipos) | [Plugins → Agir no canal](plugins.md#agir-no-canal-ações-e-leituras) |
| `http/` | `createHttp`, rotas e WebSocket de plugin e de transport, `/health` | `@zapforge/core` | [HTTP e WebSocket](http.md) |
| `logger/` | `createLogger` (pino), contexto, redação de segredos | `@zapforge/core` | [Logger](logger.md) |
| `unsafe/` | `ctx.unsafe`: objeto nativo do transport e bruto da mensagem | `@zapforge/core` (tipos) | [Escape hatch](unsafe.md) |
| `deadline.ts` | Prazos e cancelamento cooperativo (`signal`, `ContextExpiredError`) | `@zapforge/core` (erros) | [Bot → Prazos](bot.md#prazos-e-cancelamento-ctxsignal) |
| `context.ts` | Contexto de mensagem comum a middlewares, roteador e listeners | `@zapforge/core` (tipos) | [Bot → Fluxo](bot.md#fluxo-de-uma-mensagem) |
| `version.ts` | `CORE_VERSION`, contra o qual o `engine` dos plugins é conferido | `@zapforge/core` | [Plugins → Versão do core](plugins.md#versão-do-core) |

A lista exata do que cada entrada exporta é fixada em `src/entries.test.ts`.

## O contexto do plugin

O que o `setup` recebe (`PluginContext`) e onde cada campo é explicado:

| Campo | O que é | Guia |
| --- | --- | --- |
| `plugin` | `name`, `version` e `messages` já com o que a config sobrescreveu | [Config → `messages`](config.md#messages-sobrescrevível) |
| `config` | Config validada pelo schema do plugin | [Config](config.md) |
| `log` | Logger com `plugin` no contexto | [Logger](logger.md) |
| `signal` | Aborta no `teardown`, no reload ou na falha do `setup` | [Plugins → Cancelamento](plugins.md#cancelamento-cooperativo-para-autores-de-plugin) |
| `commands` | `add` e `list` | [Comandos](commands.md) |
| `roles` | `define` de papel custom | [Comandos → Papéis custom](commands.md#papéis-custom) |
| `prefixes` | Prefixo em vigor por chat; `set`/`reset` | [Comandos → Prefixo por chat](commands.md#prefixo-por-chat) |
| `conversations` | `define` dos passos de resposta esperada | [Conversas](conversations.md) |
| `events` | `on` para os eventos do bot | [Eventos](events.md) |
| `services` | `provide` e `get` | [Services](services.md) |
| `storage` | KV e coleções do plugin, `forTenant`, `shared` | [Storage](storage.md) |
| `scheduler` | `at`, `on`, `cancel` | [Scheduler](scheduler.md) |
| `send` | Envio e ações sobre mensagens e chats, pela fila de saída | [Fila de saída](outbound-queue.md) |
| `groups` | Metadados e participantes de grupo | [Plugins → Agir no canal](plugins.md#agir-no-canal-ações-e-leituras) |
| `http` | Rotas e WebSocket sob `/plugins/<nome>` | [HTTP](http.md#rotas-no-plugin) |
| `capabilities` | O que o transport suporta | [Transport → Capabilities](transport.md#capabilities) |
| `transportName` | Nome do transport do bot (`baileys`, `web`...) | [Storage → Dados comuns](storage.md#dados-comuns-a-vários-bots) |
| `self` | Contato da própria sessão; `null` até a primeira conexão | [Modelo de mensagem](message.md) |
| `unsafe` | Objeto nativo do transport | [Escape hatch](unsafe.md) |

Os formatos que o core valida (manifesto, config, `BotConfig`) estão em [Schemas](schemas.md).
