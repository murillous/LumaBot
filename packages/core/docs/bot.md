# Instância `Bot`: composição, fluxo e lifecycle

O `Bot` é a raiz do kernel: liga transport, storage, plugins, filas, middlewares, roteador,
barramento, scheduler e logger, e todo estado fica pendurado na instância, nunca em módulo
([ADR 0004](../../../docs/adr/0004-uma-sessao-por-processo.md)). Importar `@zapforge/core` e
chamar `createBot()` não abre conexão, não agenda timer, não cria logger e não registra listener
de processo — o efeito começa no `start()`.

```ts
import { createBot } from '@zapforge/core';

const bot = createBot({ transport, storage, plugins: [sticker, ai] });
await bot.start();
```

## `createBot(config)`

Só `transport` é obrigatório; `createBot({ transport })` sobe um bot sem plugins.

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `transport` | — | O canal: um `Transport` pronto ou a fábrica `(deps) => Transport` ([Transport por fábrica](#transport-por-fábrica)) |
| `session` | `'default'` | Sessão (o número) que o bot opera; kebab-case. Escopo de tudo o que ele persiste ([Sessão](#sessão)) |
| `storage` | memória, com aviso no log | `StoragePort` de plugins, scheduler e overrides de config. O bot o fecha no `stop()` (o último a parar, se vários o dividem) |
| `plugins` | `[]` | Plugins da config (pacotes npm que o app importa) |
| `pluginDirs` / `cwd` | — / `process.cwd()` | Pastas de plugins locais ([Plugins](plugins.md#fontes-config-e-plugindirs)) |
| `disabledPlugins` | `[]` | Nomes que não carregam |
| `pluginConfig` | — | Config por plugin, a camada "arquivo" ([Config](config.md)) |
| `env` | `process.env` | Ambiente lido pela config de plugin (`ZAPFORGE_*`) |
| `owners` | `[]` | Telefones dos donos; aceitos com pontuação (`'+55 11 99999-9999'`), normalizados por `normalizeOwners` — `BotConfigError` já no `createBot` se malformados |
| `prefix` | `'!'` | Prefixo de comando |
| `logger` | criado pelo bot | `Logger` pronto. Sem ele, `createLogger({ level: logLevel, secrets })` no `start()` |
| `logLevel` | `'info'` | Nível do logger criado pelo bot |
| `secrets` | um novo | `SecretSet` compartilhado entre a config de plugin e o logger (ver abaixo) |
| `middlewares` | ver [Middlewares](#middlewares) | Oficiais ligados/desligados e os do app |
| `inbound` | `{ maxPendingPerChat: 100 }` | [Fila de entrada](inbound-queue.md) |
| `outbound` | padrões da fila | [Fila de saída](outbound-queue.md): taxa, `maxPending`, `retry`, `humanize`, `maxPauseMs`, `sendTimeoutMs` |
| `reconnection` | ligada | Opções da `ReconnectionPolicy` + `clearSession`; `false` desliga ([Reconexão](#reconexão)) |
| `timeouts` | `setupMs` 10000, `teardownMs` 5000, `commandMs` 30000, `listenerMs` 30000, `jobMs` 30000, `middlewareMs` 30000 | Prazos do código de plugin e dos middlewares |
| `shutdown` | `hookTimeoutMs` 5000, `timeoutMs` 15000 | Prazos dos ganchos de parada |

Opção inválida (prefixo vazio, `maxPendingPerChat` negativo, prioridade `NaN`…) lança já no
`createBot`, com `TypeError`/`RangeError`.

**Segredos no log.** Os campos `secret` da config de plugin são resolvidos no `setup` e mudam no
reload; o logger os censura por uma fonte viva (`SecretSet`). O bot cria um e o entrega aos dois
lados. Se você passa `logger` próprio, crie-o com o mesmo conjunto:

```ts
const secrets = createSecretSet();
const bot = createBot({
  transport,
  secrets,
  logger: createLogger({ secrets, level: 'debug', bindings: { app: 'meu-bot' } }),
});
```

## O que o bot expõe

| Membro | O que é |
| --- | --- |
| `state` | `idle`, `starting`, `running`, `stopping` ou `stopped` |
| `start()` / `stop()` / `onStop()` | Lifecycle (abaixo) |
| `config.setOverrides(nome, overrides)` | Valida, salva no storage e recarrega o plugin (`teardown` → `setup`) |
| `config.describe(nome)` / `config.jsonSchema(nome)` | Config mascarada e JSON Schema, para o dashboard |
| `plugins()` | Tabela de boot atual (`PluginReportEntry[]`, reflete reloads); vazia antes do `start()` |
| `stats()` | Métricas das filas (`BotStats`): `inbound` e `outbound` (abaixo) |
| `settled()` | Espera o bot terminar de processar o que recebeu (abaixo) |

`bot.config` só funciona depois que o `start()` carregou os plugins; antes, lança
`BotStateError`.

### Métricas: `stats()`

`bot.stats()` devolve `{ inbound, outbound }`, lidos de contadores mantidos a cada operação
(leitura O(1), sem custo no caminho da mensagem). Cada chamada devolve uma cópia.

- `inbound` (`InboundQueueStats`): `activeChats`, `pending`, `processed`, `dropped` (excedeu
  `maxPendingPerChat` ou chegou com a fila fechada) e `errors`. Ver [Fila de entrada](inbound-queue.md).
- `outbound` (`OutboundQueueStats`): `pending` por prioridade, `inFlight`, `activeChats`, `sent`,
  `failed`, `retries`, `dropped` e `paused` (conexão caída). Ver
  [Fila de saída](outbound-queue.md#métricas).

Funciona em qualquer estado: antes do `start()` tudo é zero, e depois do `stop()` ficam os
valores finais (as filas não zeram ao fechar).

```ts
const { inbound, outbound } = bot.stats();
log.info('filas', { recebidas: inbound.processed, enviadas: outbound.sent });
```

### Esperar o bot assentar: `settled()`

`await bot.settled()` resolve quando o bot terminou de processar o que recebeu: a fila de entrada
está vazia, nenhum listener está em andamento e a fila de saída está vazia, **as três ao mesmo
tempo**. Como uma realimenta a outra (o comando envia, o prazo de um listener estoura e vira
`plugin.error`, cujo listener envia), a espera se repete até uma conferência achar as três
ociosas. Serve para testes, inclusive para afirmar que **nada** foi enviado, sem `vi.waitFor`
nem polling em `stats()` ([ADR 0044](../../../docs/adr/0044-espera-pelo-bot-assentar.md)).

```ts
transport.emit('message', mensagem('!ping'));
await bot.settled();
expect(transport.sent).toHaveLength(1);
```

O que entra e o que fica de fora:

- **Entra**: mensagens e edições (fila de entrada, middlewares, comando, listeners), eventos
  diretos (`reaction`, grupos, `contact.updated`; ADR 0038), `plugin.error`, `connection.*` e
  tudo o que já está na fila de saída, inclusive em espera de re-tentativa.
- **Fica de fora**: jobs do scheduler (não foram recebidos; dispare o job e espere o efeito dele)
  e trabalho que o plugin agenda por conta própria (`setTimeout`, promise solta que só depois
  envia).
- **Fila de saída pausada** (conexão caída): espera a reconexão ou o `maxPauseMs` descartar o que
  aguarda. Para não esperar, junte com um prazo seu (`Promise.race`).
- **Durante o boot**: espera os plugins subirem e o que chegou nesse meio-tempo. Antes do
  `start()` e depois do `stop()`, resolve na hora. Nunca rejeita.
- Listener que estoura o prazo deixa de contar (ele segue em segundo plano, ADR 0042); um preso
  segura o `settled()` até o prazo, 30 s por padrão.

Com os intervalos padrão da fila de saída (300 ms global, 1000 ms por chat), cada envio espera de
verdade: em teste, zere `outbound.globalIntervalMs` e `outbound.chatIntervalMs`.

Só roda quando chamado: o caminho da mensagem não paga nada além de um contador por listener
assíncrono.

## Fluxo de uma mensagem

Plano §5.3 e [ADR 0012](../../../docs/adr/0012-pipeline-de-3-estagios.md):

```
transport 'message' ou 'message.edited'
  → fila de entrada (mesmo chat em série)
  → middlewares (onion, por prioridade)          interrompeu? fim
    → roteador de comandos (só 'message')        casou? roda o comando e consome
    → barramento: listeners de 'message' e 'message:<tipo>' (ou de 'message.edited'),
      em paralelo, com claim()
  ← volta dos middlewares (depois do comando ou dos listeners)
ctx.reply()/ctx.send → fila de saída → transport
```

- Cada mensagem ganha um contexto (`BotMessageContext`): `message`, `text` (o texto de
  trabalho), `reply` e `log` (com `chatId`). `reply` e `log` só são criados se alguém os ler.
- **`ctx.text`** começa igual a `message.text`. Um middleware pode reescrevê-lo — o `sanitize`
  grava ali o texto truncado — e o roteador e os listeners leem o resultado. `message` nunca muda.
- **Middleware que não chama `next()`** barra a mensagem: nem comando nem listeners a veem.
- **Comando e listeners rodam dentro dos middlewares**: o código depois de `await next()` roda
  quando eles terminam, então um middleware mede o tratamento inteiro, mantém o "digitando" ou
  libera um recurso no fim. A volta espera também os prazos (`commandMs`, `listenerMs`).
- **Middleware tem prazo** (`timeouts.middlewareMs`, 30 s; [ADR 0043](../../../docs/adr/0043-prazo-de-middleware.md)),
  contado fora do `next()`. Estourado, a mensagem é descartada com `MiddlewareTimeoutError` no
  log e o chat segue ([Middlewares](middleware.md#prazo)).
- **Handler lento segura o chat** ([ADR 0042](../../../docs/adr/0042-handler-lento-segura-o-chat.md)):
  a fila de entrada só passa à próxima mensagem do chat quando o comando ou **todos** os
  listeners terminam (ou estouram o prazo). Uma chamada de LLM de 15 s num listener faz o
  `!sticker` seguinte do mesmo grupo esperar 15 s; outros chats não esperam. É o que garante a
  ordem para quem guarda estado por conversa. Trabalho longo que não depende dessa ordem se
  solta do handler (ver [Eventos](events.md#trabalho-longo-solte-o-chat)). Com o backlog em
  `inbound.maxPendingPerChat`, as mensagens novas do chat são descartadas, com `warn` e
  `stats().inbound.dropped`.
- **Comando que casa consome** a mensagem, mesmo recusado (papel, `accepts`) ou com erro. A
  resposta de `onReject` sai pelo `ctx.reply`. Comando que lança vira `plugin.error`
  (`phase: 'command'`, `event` = nome do comando) e uma linha de log em `error`; o chat segue.
- **Prazo de comando** (`timeouts.commandMs`, padrão 30 s, [ADR 0005](../../../docs/adr/0005-plugins-no-mesmo-processo.md);
  o `timeoutMs` de um comando sobrescreve só para ele, ver [Comandos](commands.md#resultado-de-dispatch)):
  um `run` que não termina no prazo vira `plugin.error` com `timedOut: true` e erro
  `CommandTimeoutError` (`plugin`, `command`, `timeoutMs`, `stage: 'run'`), e o chat passa para
  a próxima mensagem. O `run` não é cancelado (não há como) e segue em segundo plano; se ele
  rejeitar depois, o erro vai só para o log. O `ctx.signal` do comando aborta nesse momento e o
  `reply` dele passa a ser recusado (ver [Prazos e cancelamento](#prazos-e-cancelamento-ctxsignal)).
  O `onReject` tem o mesmo prazo, contado à parte (`stage: 'onReject'`, com `signal` e `reply`
  próprios). A consulta de admin ao transport (`role: 'group-admin'`) também: estourada, o
  comando não roda e sai `plugin.error` com `timedOut: true` e `GroupAdminTimeoutError`
  (`chatId`, `timeoutMs`).
- **Middlewares do app não têm prazo**: são código do app, não de plugin (ADR 0005 isola
  plugins). Um middleware que nunca chama `next()` nem resolve segura o chat dele na fila de
  entrada; quem escreve middleware assíncrono responde por limitar o próprio I/O.
- **Listeners** de eventos de mensagem recebem, além de `payload`/`claimed`/`claim()`/`signal`,
  os campos `message`, `text`, `reply` e `log` (este com `plugin` e `chatId`).
- **`message.edited`** passa pelas mesmas barreiras da mensagem nova: entra na fila do chat
  (em série com as mensagens dele), espera o fim do boot e roda os middlewares — `ignoreSelf` e
  `chatFilter` a barram, o `sanitize` trunca o `text` e o `rateLimit` a conta como uma mensagem.
  Edição não dispara comando: passou, vai aos listeners de `message.edited` (com os mesmos
  campos). Um middleware do app vê as edições também e as distingue por `ctx.message.isEdited`.
- Os demais eventos do transport vão ao barramento sem fila nem middlewares, mas com os filtros
  da config de middlewares ([ADR 0038](../../../docs/adr/0038-filtro-de-eventos-no-kernel.md)).
  Veja [Eventos que não são mensagem](#eventos-que-não-são-mensagem).
- Erro de middleware (ou do próprio roteador) vai para o log em `error`, com o `chatId`; o chat
  segue para a próxima mensagem.
- O chat só libera a próxima mensagem quando a atual termina (comando ou todos os listeners). A
  resposta de recusa do roteador não é esperada: ela aguarda a taxa da fila de saída.

### Middlewares

Os oficiais entram nesta ordem (de fora para dentro), e os do app depois, com prioridade `0`:

| Middleware | Prioridade | Padrão | Opção |
| --- | --- | --- | --- |
| `ignoreSelf` | 1000 | **ligado** | `ignoreSelf: false` desliga |
| `chatFilter` | 900 | desligado | `chatFilter: { allow, block }` |
| `rateLimit` | 800 | desligado | `rateLimit: { max, windowMs, by }`; sem `onLimited`, loga em `debug` |
| `sanitize` | 700 | **ligado** (4096 / 100) | `sanitize: { maxTextLength }`; `false` desliga |

```ts
createBot({
  transport,
  middlewares: {
    chatFilter: { block: ['123@g.us'] },
    rateLimit: { max: 10, windowMs: 1000 },
    use: [
      timing,                                  // prioridade 0
      { middleware: apenasGrupos, priority: 950 }, // entre ignoreSelf e chatFilter
    ],
  },
});
```

#### Eventos que não são mensagem

As opções `chatFilter` e `ignoreSelf` valem também para os eventos que não passam pelo pipeline
([ADR 0038](../../../docs/adr/0038-filtro-de-eventos-no-kernel.md)). O kernel aplica as regras
antes de repassá-los ao barramento:

| Evento | `chatFilter` (por) | `ignoreSelf` |
| --- | --- | --- |
| `reaction` | `chat.id` | barra `fromMe: true` |
| `message.deleted` | `chat.id` | barra `fromMe: true` |
| `group.participants`, `group.updated` | `groupId` | — |
| `group.joined`, `group.left`, `contact.updated` | sempre passam | — |
| `connection.status`, `connection.qr` | — | — |

`group.joined` e `group.left` passam mesmo com o grupo bloqueado: são o ciclo de vida do próprio
bot no grupo e servem para o plugin limpar estado. `contact.updated` não é de um chat: o mesmo
contato aparece em chats liberados. Esses eventos esperam o fim do boot (um evento
que chega durante o `setup` de um plugin não se perde), mas não entram na fila do chat: uma reação
pode chegar aos listeners antes de a mensagem reagida terminar de ser processada. Middlewares do
app não veem esses eventos.

O padrão liga só o que não muda comportamento esperado: o bot não responde a si mesmo e texto
gigante não chega aos plugins. Rate limit e filtro de chats dependem de números e listas que só o
app conhece.

## Plugins

No `start()` o bot junta `plugins` e `pluginDirs`, monta a config de cada um e roda os `setup`
em ordem topológica ([Plugins](plugins.md)). O `ctx` que o plugin recebe é ligado aos serviços da
instância, sempre em nome do plugin:

| Campo | Ligado a |
| --- | --- |
| `plugin` | `name`, `version` e `messages` já mesclados com a config |
| `config` | config validada (`PluginConfigError` ignora o plugin, ADR 0032) |
| `log` | logger do bot com `{ plugin }` |
| `signal` | aborta no descarte do contexto (teardown, reload, `setup` que falhou ou estourou o prazo) |
| `commands.add` | roteador do bot; o `run`/`onReject` recebem `log` com `plugin` e `chatId` |
| `roles.define` | papéis do roteador ([papéis custom](commands.md#papéis-custom)); o `check` recebe `log` do plugin dono e `signal` |
| `events` | barramento do bot |
| `services` | registry do bot |
| `storage` | storage no namespace do plugin |
| `scheduler` | scheduler do bot, namespace do plugin |
| `send` | fila de saída |
| `unsafe` | escape hatch, com aviso uma vez por plugin |

No `teardown`/reload o bot remove tudo o que o plugin registrou (comandos, papéis, listeners,
serviços, handlers de job). Um `setup` que estoura o prazo continua rodando em segundo plano; depois do
descarte, o contexto **recusa** `commands.add`, `roles.define`, `events.on`, `services.provide`
e `scheduler.on` (lançam `PluginHostStateError`), para nada ficar órfão, e `send`, `storage` (KV e
coleções) e `scheduler.at`/`cancel` (rejeitam com `ContextExpiredError`), para nenhum efeito sair
de um plugin que já desceu. O `ctx.signal` do plugin aborta no descarte.

**Janela do reload**: entre o teardown e o fim do `setup` novo, os comandos do plugin não estão
no registro. Uma mensagem que chega nessa janela (`!sticker` durante o reload do `sticker`) não
casa com comando nenhum e segue para os listeners de `message` como texto comum; um plugin de
conversa pode respondê-la. Comando de outro plugin que exige papel do plugin recarregando é
recusado (o papel some junto). A janela dura o `setup` do plugin (e dos dependentes em cascata);
no bot, o reload vem do `config.setOverrides`, não do caminho normal da mensagem.
Listener que não deve responder a comandos pode ignorar o texto que começa com o prefixo.

Destino dos erros de plugin — todos viram `plugin.error` no barramento e linha de log:

| Fase | Origem |
| --- | --- |
| `setup` | fábrica de contexto ou `setup` lançou/estourou o prazo (o plugin fica ignorado na tabela) |
| `teardown` | `teardown`/limpeza no reload ou no `stop()` (no `stop()`, também no `AggregateError`) |
| `command` | `run`, `onReject` ou a consulta de admin lançou, ou um deles estourou `timeouts.commandMs` (`timedOut: true`) |
| `role` | `check` de um papel custom lançou, rejeitou ou estourou `timeouts.commandMs` (`event` = papel; vai para o plugin **dono do papel**, e o comando é recusado) |
| `listener` | listener lançou, rejeitou ou estourou o prazo |
| `scheduler` | handler de job lançou, rejeitou ou estourou o prazo |

**Conflito de nome derruba o boot** ([ADR 0007](../../../docs/adr/0007-plugins-via-npm-e-pasta.md),
[ADR 0035](../../../docs/adr/0035-papeis-nomeados-por-plugin.md)): se o `setup` de um plugin falha
com `CommandConflictError`, `RoleConflictError` ou `ServiceConflictError`, o `start()` encerra o
que subiu e rejeita com esse erro. Os demais erros de `setup`, e os conflitos num `reload`, só
ignoram o plugin.

## Prazos e cancelamento (`ctx.signal`)

O JS não mata uma promise: um comando, listener, job ou `setup` que estoura o prazo segue rodando
em segundo plano ([ADR 0005](../../../docs/adr/0005-plugins-no-mesmo-processo.md)). O kernel
oferece **cancelamento cooperativo** ([ADR 0033](../../../docs/adr/0033-cancelamento-cooperativo.md)):

| Onde | `signal` | Aborta quando | `reason` |
| --- | --- | --- | --- |
| Comando (`run` e `onReject`) | `c.signal` | o `timeoutMs` do comando (ou `timeouts.commandMs`) estoura (cada um conta o seu), ou o plugin é descartado | `CommandTimeoutError`, ou o motivo do descarte |
| Papel custom (`check`) | `c.signal` | `timeouts.commandMs` estoura, ou o plugin dono do papel é descartado | `RoleTimeoutError`, ou o motivo do descarte |
| Listener (todo evento) | `e.signal` | o prazo **deste** listener estoura, ou o plugin é descartado | `ListenerTimeoutError`, ou o motivo do descarte |
| Job do scheduler | `handler(payload, { signal })` | `timeouts.jobMs` estoura, ou o plugin é descartado | `JobTimeoutError`, ou o motivo do descarte |
| Plugin (`setup`) | `ctx.signal` | o contexto é descartado (teardown, reload, `setup` que falhou/estourou) | erro do `setup`, ou `PluginHostStateError` no descarte normal |

O prazo mede o tempo **do plugin**. Enquanto um `reply` ou `react` do contexto de um comando ou
listener aguarda a fila de saída, o relógio do prazo para, e volta com o que sobrou quando o envio
assenta ([ADR 0046](../../../docs/adr/0046-espera-na-fila-de-saida-fora-do-prazo.md)). A espera
pela taxa anti-ban, o "digitando" da humanização, as re-tentativas e a chamada ao transport não
contam: uma rajada em muitos chats não vira `timedOut` de comando que funcionou. O `ctx.send` do
plugin, `ctx.groups` e os jobs continuam contando, porque não pertencem a uma execução.

Depois do prazo, o que o contexto expirado tentar fazer é **recusado**, em vez de executar:

- `reply` de um comando ou listener expirado rejeita com `ContextExpiredError` (`plugin`,
  `operation`, `scope`, `cause` = o erro de timeout) e sai uma linha `warn` com o plugin e o
  comando/evento. Vale também para o `reply` guardado antes do prazo (`const r = c.reply`). Se
  o plugin não tratar a rejeição, ela não é logada de novo como erro tardio: a linha `warn` basta.
- `send`, `storage` e `scheduler.at`/`cancel` do `PluginContext` descartado rejeitam igual.
- O descarte do plugin (teardown, reload) **expira junto** os comandos, papéis, listeners e jobs
  dele ainda em andamento: o `signal` de cada um aborta com o mesmo motivo do `ctx.signal` do
  plugin, e o `reply` passa a ser recusado. Vale também no `stop()` cuja drenagem da fila de
  entrada estourou o prazo: o comando que seguia vivo para de responder no teardown.
- `CommandTimeoutError`, `ListenerTimeoutError` e `JobTimeoutError` estendem
  `ExecutionTimeoutError` (`plugin`, `timeoutMs`): `signal.reason instanceof
  ExecutionTimeoutError` distingue timeout de descarte do contexto.
- O prazo é **por listener**: um listener lento expirar não aborta o `signal` nem bloqueia o
  `reply` de outro listener do mesmo evento que está no prazo.

Repasse o `signal` ao trabalho assíncrono, para ele parar junto:

```ts
command({
  name: 'clima',
  run: async (c) => {
    const res = await fetch(url, { signal: c.signal }); // aborta no prazo
    c.signal.throwIfAborted(); // antes de um efeito que não aceita signal
    await ctx.storage.kv.set('ultima', await res.text());
    await c.reply('ok');
  },
});
```

Limites:

- O `ctx.send`/`ctx.storage` que o comando usa pelo closure do `setup` são do **plugin**, não do
  comando: o kernel não sabe de qual execução a chamada veio. Eles só são recusados depois do
  descarte do plugin. Dentro de um comando, listener ou job, confira `signal.aborted` (ou
  `throwIfAborted()`) antes de efeitos que não recebem o `signal`.
- Código **síncrono** travado (laço infinito, CPU pesada) bloqueia o processo inteiro: o timer do
  prazo nem chega a disparar, e nenhum prazo resolve isso.
- O `signal` não tem timer próprio: é abortado pelos mesmos timers de prazo que já existiam. O
  `AbortController` só é criado se alguém ler `signal`.

## Estados

`bot.state` é só leitura:

```
idle ──start()──▶ starting ──boot ok──▶ running ──stop()──▶ stopping ──▶ stopped
                      │                                          ▲
                      └────────── boot falhou / stop() ──────────┘
```

`stopped` é terminal: um bot parado não reinicia. Para subir de novo, crie outra instância.

| Chamada | `idle` | `starting` | `running` | `stopping` | `stopped` |
| --- | --- | --- | --- | --- | --- |
| `start()` | sobe | mesma promise | resolve | `BotStateError` | `BotStateError` |
| `stop()` | ganchos, sem `disconnect` | espera o boot e encerra | encerra | mesma promise | resolve |
| `onStop()` | registra | registra | registra | `BotStateError` | `BotStateError` |

## Boot (`start`)

Em ordem (plano §5.3):

1. Cria o logger, reserva a sessão no storage (`BotConfigError` se outro bot vivo já a usa) e
   (sem `storage`) avisa que os dados estão em memória.
2. Assina os eventos do transport e empilha os ganchos de parada internos.
3. Carrega os plugins: coleta (`plugins` + `pluginDirs`) → config → `setup` de cada um → tabela
   de boot no log → checagem de conflito de comando, papel e serviço.
4. **Só se o boot dos plugins deu certo**, chama `transport.connect()`; conectado, liga a
   reconexão automática.
5. Liga o scheduler (dispara os jobs vencidos no downtime) e passa a `running`.

Plugin quebrado (conflito de comando, papel ou serviço, manifesto inválido, ciclo, `pluginDirs`
ilegível) derruba o boot **antes** de o transport abrir sessão: sem QR nem handshake à toa.
Mensagens que chegam durante o handshake aguardam na fila de entrada e são processadas no fim do
boot; se o boot falha, são descartadas.

**Falha no boot**: o bot roda o shutdown e termina em `stopped`. Se a falha foi dos plugins, o
transport nunca conectou e o `disconnect()` não é chamado. Se foi do `connect()`, o shutdown
inclui o `disconnect()`, porque o transport pode ter conectado pela metade (o adapter precisa
tolerar isso). O `start()` rejeita com o erro do boot; se o encerramento também falhar, com um
`AggregateError` cujo primeiro item é esse erro.

**`stop()` durante o `start()`**: o `stop()` espera o boot assentar e então encerra; o `start()`
pendente rejeita com `BotStateError`, porque o bot nunca chegou a `running`. Se o `stop()` chega
enquanto os plugins sobem, o transport nem conecta (sem QR nem handshake à toa) e o
`disconnect()` não é chamado.

## Shutdown gracioso (`stop`)

`stop()` roda os ganchos de parada em **LIFO** (quem registrou por último desce primeiro), depois
`transport.disconnect()` e, por fim, `storage.close()`. Os ganchos internos, registrados no
`start()`, ficam no topo da pilha e rodam nesta ordem:

| # | Gancho | Prazo | O que faz |
| --- | --- | --- | --- |
| 1 | `transporte` | 1 s | Para de ouvir o transport (nada novo entra) e cancela a reconexão (nenhum timer sobra) |
| 2 | `fila-de-entrada` | 4 s | Drena: as mensagens já aceitas terminam de ser processadas; estourado o prazo, descarta as que aguardam |
| 3 | `scheduler` | 2 s | Desarma o timer e espera os jobs em andamento; estourado o prazo, abandona-os (o job fica no storage e dispara na próxima subida) |
| 4 | `plugins` | 5 s | `teardown` de cada plugin, na ordem inversa da carga; estourado o prazo, o teardown em curso é abandonado e os seguintes não rodam |
| 5 | `fila-de-saida` | 3 s | Drena os envios; estourado o prazo, descarta o resto (`close({ drain: false })`). Com a conexão caída, descarta já: a reconexão parou no gancho 1 |
| — | ganchos do app registrados **antes** do `start()` | | |
| — | abandono dos internos | sem prazo | Encerra à força o que os ganchos internos não encerraram (abaixo) |
| — | `transport.disconnect()` | sem prazo | só se o `connect()` chegou a ser chamado |
| — | `storage.close()` | sem prazo | só se o bot chegou a dar `start()` e nenhum outro bot (outra sessão) ainda usa o storage |

O scheduler para antes do `teardown`: nenhum job dispara contra um plugin em descida, e o
`teardown` só começa depois que os jobs em andamento terminam. Os prazos internos somam o total
padrão (15 s), então cada gancho tem o seu prazo inteiro mesmo que os anteriores o esgotem.

**Nada sobrevive ao `stop()`.** Um gancho interno pode não encerrar o que é dele: estoura o
prazo, ou nem roda, porque o prazo total acabou antes (por exemplo, gasto por um gancho do app
registrado com o bot rodando). Por isso, depois dos ganchos e antes do `disconnect()`, o bot
abandona tudo o que restou: solta os eventos do transport, para a reconexão, descarta o que
aguarda nas filas de entrada e de saída, abandona os jobs em andamento e o `teardown` em curso,
pula os `teardown` restantes e faz o `dispose` de todos os plugins (o kernel desfaz comandos,
listeners e handlers; o contexto do plugin passa a recusar operações). Também desarma o prazo
de todo middleware, comando (`run` e `onReject`), checagem de papel, consulta de admin e listener
ainda presos: a execução abandonada não vira timeout nem `plugin.error`, porque o bot já parou.
Quando o `stop()` termina, nenhum timer do bot fica vivo. Os `teardown` pulados ou abandonados viram
`PluginLifecycleError` com `timedOut: true` no log. O que o código do plugin ainda estiver
rodando (um `teardown` travado, um job) o JS não interrompe: ele recebe o `signal` abortado e
o que tentar pelo contexto é recusado.

Ganchos do app registrados com o bot já rodando ficam acima dos internos e rodam antes deles
(ainda dá para enviar mensagem); os registrados antes do `start()` rodam depois (bom para fechar
recursos que os plugins usam).

```ts
const remove = bot.onStop(async (signal) => {
  await meuRecurso.close({ signal });
}, { name: 'meu-recurso', timeoutMs: 10_000 });

remove(); // desfaz o registro, se o recurso for liberado antes
```

- Cada gancho tem um prazo (`timeoutMs` do gancho, ou `shutdown.hookTimeoutMs`). Estourado, o
  `signal` aborta e o bot segue para o próximo.
- O prazo total dos ganchos é `shutdown.timeoutMs` (padrão 15 s). Esgotado, os ganchos restantes
  não rodam. `disconnect()` e `storage.close()` rodam sempre, sem prazo.
- Erro de uma etapa não impede as outras. No fim, o bot está em `stopped` e o `stop()` rejeita
  com um `AggregateError` com todas as falhas: cada gancho vira um `StopHookError` (`hookName`,
  `timedOut`, erro original em `cause` — no gancho `plugins`, um `AggregateError` com os
  `PluginLifecycleError` dos teardowns); os erros do `disconnect()` e do `close()` vão como
  vieram.

## Reconexão

O transport avisa as quedas por `connection.status`; a `ReconnectionPolicy`
([Transport](transport.md#política-de-reconexão)) decide e o bot executa:

| Decisão | O bot |
| --- | --- |
| `reconnect` | espera `delayMs` e chama `transport.connect()` |
| `clean-session` com `clearSession` | espera `delayMs`, chama `clearSession()` e reconecta |
| `clean-session`, transport por fábrica, sem `clearSession` | espera `delayMs`, limpa o `auth` que a fábrica recebeu e reconecta |
| `clean-session`, instância pronta, sem `clearSession` | loga em `error` que a sessão precisa de novo pareamento e para o bot (`stop()`) |
| `stop` (motivo `replaced`) | loga em `error` que outra conexão assumiu a sessão e para o bot, sem reconectar nem limpar |

- `clean-session` só vem de `logged-out`, `auth-failed` ou `qr-limit`. Queda de rede reconecta
  sem limite de tentativas e nunca apaga as credenciais
  ([ADR 0045](../../../docs/adr/0045-queda-de-rede-nao-limpa-sessao.md)); para desistir após um
  tempo, observe `connection.status` e chame `bot.stop()`.
- Um `connect()` de reconexão que falha conta como queda (`connection-lost`): a política decide
  de novo, com a tentativa seguinte do backoff.
- Há no máximo um timer de reconexão por vez, e nenhum sobrevive ao `stop()`. O `closed` que o
  próprio `disconnect()` do shutdown gera não reconecta.
- `connection.qr` conta para o limite de QRs da política e vai para o barramento (um plugin pode
  desenhar o QR). O log em `info` só avisa que chegou um QR; o valor (campo `qr`) sai em `debug`,
  porque quem lê o log (agregador, arquivo) pareia o número enquanto o QR vale.
- `connection.status`/`connection.qr` também chegam aos listeners.
- Do `closed` ao `open`, a fila de saída fica pausada: as respostas esperam a reconexão em vez de
  esgotar o retry, até `outbound.maxPauseMs` (padrão 60 s; depois, rejeitam com
  `OutboundQueueError` `'disconnected'`). Ver [Fila de saída](outbound-queue.md#conexão-caída).

```ts
createBot({
  transport: baileys({ pairing: 'qr' }), // fábrica: o clean-session limpa o auth sozinho
  storage,
  reconnection: {
    backoff: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
  },
});
```

Com um transport pronto (instância), o bot não sabe onde estão as credenciais: passe
`clearSession: () => storage.authState('<sessão>').clear()`. Com fábrica, `clearSession`
substitui a limpeza padrão (ex.: para também apagar arquivos do adapter).

`replaced` é o caso de dois processos com o mesmo número: reconectar derrubaria a outra conexão,
que derrubaria esta, em laço. O bot para e deixa a outra seguir.

## Exemplo ponta a ponta

```ts
import {
  command,
  createBot,
  createLogger,
  createSecretSet,
  definePlugin,
  secret,
} from '@zapforge/core';
import { z } from 'zod';

declare module '@zapforge/core' {
  interface Services {
    clima: { previsao(cidade: string): Promise<string> };
  }
}

const clima = definePlugin({
  name: 'clima',
  version: '1.0.0',
  engine: '^0.1.0',
  config: z.object({ apiKey: secret(z.string()), cidadePadrao: z.string().default('Recife') }),
  messages: { erro: 'Não consegui a previsão agora 😕' },

  setup(ctx) {
    const previsao = async (cidade: string) => `${cidade}: 30 °C`; // chamaria a API com apiKey
    ctx.services.provide('clima', { previsao });

    ctx.commands.add(
      command({
        name: 'clima',
        aliases: ['tempo'],
        run: async (c) => {
          const cidade = c.rawArgs || ctx.config.cidadePadrao;
          await ctx.storage.kv.set(`ultima:${c.message.chat.id}`, cidade);
          c.log.info('previsão pedida', { cidade }); // plugin + chatId no log
          await c.reply(await previsao(cidade));
        },
      }),
    );

    // Responde a quem fala de chuva, se nenhum listener de prioridade maior já respondeu.
    ctx.events.on('message', { priority: -10 }, async (e) => {
      if (e.claimed || !e.text?.includes('chuva')) return;
      e.claim(); // antes do primeiro await
      await e.reply(await previsao(ctx.config.cidadePadrao));
    });
  },
});

const secrets = createSecretSet();
const bot = createBot({
  transport,             // ex.: baileys({ ... }) — M2
  storage,               // ex.: sqlite({ path }) — M2
  plugins: [clima],
  pluginConfig: { clima: { cidadePadrao: 'Olinda' } }, // apiKey vem de ZAPFORGE_CLIMA__API_KEY
  owners: ['+55 81 99999-9999'],
  secrets,
  logger: createLogger({ secrets }),
  middlewares: { rateLimit: { max: 10, windowMs: 10_000 } },
});

await bot.start();
process.once('SIGTERM', () => void bot.stop().finally(() => process.exit(0)));
```

`!clima Natal` passa pelos middlewares, casa o comando, grava no storage do plugin e responde
citando a mensagem; `vai chover?` não é comando e chega ao listener, que reivindica e responde.

## Sinais do processo

O core não instala handler de `SIGINT`/`SIGTERM` — isso é decisão do app:

```ts
process.once('SIGTERM', () => {
  bot.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
});
```

## Sessão

`session` identifica o número que o bot opera ([ADR 0036](../../../docs/adr/0036-escopo-de-sessao.md)).
Tudo o que o bot persiste fica no escopo dela: o storage de cada plugin, os jobs do scheduler e
os overrides de config. Assim, vários números podem dividir um storage (um Postgres para todos,
por exemplo) sem um ver os jobs, o KV ou a config do outro.

```ts
const vendas = createBot({ transport: transportVendas, storage, session: 'vendas' });
const suporte = createBot({ transport: transportSuporte, storage, session: 'suporte' });
```

- O nome segue a regra de nome de plugin (kebab-case minúsculo, começando por letra); fora dela,
  `createBot` lança `BotConfigError`.
- **Trocar o nome "esquece" os dados**: jobs, KV e overrides da sessão anterior ficam no storage,
  mas o bot não os vê mais. Escolha o nome uma vez.
- A sessão `'default'` (o padrão) guarda nos namespaces sem prefixo; as outras, em
  `<sessão>:<namespace>` ([Storage](storage.md#para-o-kernel)).
- A mesma sessão não roda duas vezes no mesmo storage: o `start()` do segundo bot rejeita com
  `BotConfigError`, sem afetar o primeiro. Depois do `stop()` a sessão fica livre.
- Entre processos o storage não sabe quem está vivo; ali quem protege é o transport, com
  `DisconnectReason` `'replaced'` ([Reconexão](#reconexão)).
- O auth state do transport segue o mesmo nome: `storage.authState('<sessão>')`, que o transport
  por fábrica já recebe pronto em `deps.auth`.
- Um storage compartilhado só fecha quando o último bot que o usa para.

## Transport por fábrica

`transport` aceita uma fábrica `(deps: TransportDeps) => Transport`
([ADR 0037](../../../docs/adr/0037-transport-por-fabrica.md)). É a forma dos adapters oficiais:
o app escreve `transport: baileys({ ... })` e o bot entrega ao adapter o que é dele, sem o app
ligar transport e storage à mão nem repetir a sessão.

| `deps` | O que é |
| --- | --- |
| `session` | A `session` do bot |
| `auth` | `storage.authState(session)` |
| `log` | Logger do bot com `{ transport: name }`, com a censura de segredos |

- O `createBot` chama a fábrica **uma vez**, na hora. Ela só monta o objeto: a conexão começa no
  `connect()`, que o `start()` chama. Se a fábrica lança, o `createBot` lança `BotConfigError`
  com o erro original em `cause`.
- O logger real só nasce no `start()`; até lá, o `deps.log` descarta as linhas. Depois, a mesma
  referência passa a escrever no logger do bot: o adapter pode guardá-la no construtor.
- Com fábrica, o `clean-session` da reconexão limpa o `deps.auth` sem configuração
  ([Reconexão](#reconexão)).
- Uma instância pronta continua aceita (testes, adapters que não precisam do bot).

Como escrever um adapter com fábrica: [Transport](transport.md#adapter-com-fábrica).

## Várias instâncias

Duas chamadas a `createBot` não compartilham nada — roteador, barramento, filas, scheduler,
registry de serviços, logger e storage padrão são da instância. A mesma `PluginDefinition` pode
servir aos dois bots: cada um monta o próprio contexto. É o caminho para multi-sessão
([ADR 0004](../../../docs/adr/0004-uma-sessao-por-processo.md)).
