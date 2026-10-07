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
| `transport` | — | O canal (`Transport`) |
| `storage` | memória, com aviso no log | `StoragePort` de plugins, scheduler e overrides de config. O bot o fecha no `stop()` |
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
| `outbound` | padrões da fila | [Fila de saída](outbound-queue.md): taxa, `maxPending`, `retry`, `humanize` |
| `reconnection` | ligada | Opções da `ReconnectionPolicy` + `clearSession`; `false` desliga ([Reconexão](#reconexão)) |
| `timeouts` | `setupMs` 10000, `teardownMs` 5000, `commandMs` 30000, `listenerMs` 30000, `jobMs` 30000 | Prazos do código de plugin |
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

`bot.config` só funciona depois que o `start()` carregou os plugins; antes, lança
`BotStateError`.

## Fluxo de uma mensagem

Plano §5.3 e [ADR 0012](../../../docs/adr/0012-pipeline-de-3-estagios.md):

```
transport 'message'
  → fila de entrada (mesmo chat em série)
  → middlewares (onion, por prioridade)          interrompeu? fim
  → roteador de comandos                         casou? roda o comando e consome: fim
  → barramento: listeners de 'message' e 'message:<tipo>', em paralelo, com claim()
ctx.reply()/ctx.send → fila de saída → transport
```

- Cada mensagem ganha um contexto (`BotMessageContext`): `message`, `text` (o texto de
  trabalho), `reply` e `log` (com `chatId`). `reply` e `log` só são criados se alguém os ler.
- **`ctx.text`** começa igual a `message.text`. Um middleware pode reescrevê-lo — o `sanitize`
  grava ali o texto truncado — e o roteador e os listeners leem o resultado. `message` nunca muda.
- **Middleware que não chama `next()`** barra a mensagem: nem comando nem listeners a veem.
- **Comando que casa consome** a mensagem, mesmo recusado (papel, `accepts`) ou com erro. A
  resposta de `onReject` sai pelo `ctx.reply`. Comando que lança vira `plugin.error`
  (`phase: 'command'`, `event` = nome do comando) e uma linha de log em `error`; o chat segue.
- **Prazo de comando** (`timeouts.commandMs`, padrão 30 s, [ADR 0005](../../../docs/adr/0005-plugins-no-mesmo-processo.md)):
  um `run` que não termina no prazo vira `plugin.error` com `timedOut: true` e erro
  `CommandTimeoutError` (`plugin`, `command`, `timeoutMs`), e o chat passa para a próxima
  mensagem. O `run` não é cancelado (não há como) e segue em segundo plano; se ele rejeitar
  depois, o erro vai só para o log. O prazo vale para o `run`, não para `onReject`. O
  `ctx.signal` do comando aborta nesse momento e o `reply` dele passa a ser recusado (ver
  [Prazos e cancelamento](#prazos-e-cancelamento-ctxsignal)).
- **Listeners** de eventos de mensagem recebem, além de `payload`/`claimed`/`claim()`/`signal`,
  os campos `message`, `text`, `reply` e `log` (este com `plugin` e `chatId`).
- `message.edited` vai direto aos listeners (com os mesmos campos), sem middlewares nem comandos.
  Os demais eventos do transport (reações, grupos, conexão) também vão direto ao barramento.
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
| `events` | barramento do bot |
| `services` | registry do bot |
| `storage` | storage no namespace do plugin |
| `scheduler` | scheduler do bot, namespace do plugin |
| `send` | fila de saída |
| `unsafe` | escape hatch, com aviso uma vez por plugin |

No `teardown`/reload o bot remove tudo o que o plugin registrou (comandos, listeners, serviços,
handlers de job). Um `setup` que estoura o prazo continua rodando em segundo plano; depois do
descarte, o contexto **recusa** `commands.add`, `events.on`, `services.provide` e
`scheduler.on` (lançam `PluginHostStateError`), para nada ficar órfão, e `send`, `storage` (KV e
coleções) e `scheduler.at`/`cancel` (rejeitam com `ContextExpiredError`), para nenhum efeito sair
de um plugin que já desceu. O `ctx.signal` do plugin aborta no descarte.

Destino dos erros de plugin — todos viram `plugin.error` no barramento e linha de log:

| Fase | Origem |
| --- | --- |
| `setup` | fábrica de contexto ou `setup` lançou/estourou o prazo (o plugin fica ignorado na tabela) |
| `teardown` | `teardown`/limpeza no reload ou no `stop()` (no `stop()`, também no `AggregateError`) |
| `command` | `run`, `onReject` ou a consulta de admin lançou, ou o `run` estourou `timeouts.commandMs` (`timedOut: true`) |
| `listener` | listener lançou, rejeitou ou estourou o prazo |
| `scheduler` | handler de job lançou, rejeitou ou estourou o prazo |

**Conflito de comando derruba o boot** ([ADR 0007](../../../docs/adr/0007-plugins-via-npm-e-pasta.md)):
se o `setup` de um plugin falha com `CommandConflictError`, o `start()` encerra o que subiu e
rejeita com esse erro. Os demais erros de `setup` só ignoram o plugin.

## Prazos e cancelamento (`ctx.signal`)

O JS não mata uma promise: um comando, listener, job ou `setup` que estoura o prazo segue rodando
em segundo plano ([ADR 0005](../../../docs/adr/0005-plugins-no-mesmo-processo.md)). O kernel
oferece **cancelamento cooperativo** ([ADR 0033](../../../docs/adr/0033-cancelamento-cooperativo.md)):

| Onde | `signal` | Aborta quando | `reason` |
| --- | --- | --- | --- |
| Comando (`run`) | `c.signal` | `timeouts.commandMs` estoura | `CommandTimeoutError` |
| Listener (todo evento) | `e.signal` | o prazo **deste** listener estoura | `Error` de timeout |
| Job do scheduler | `handler(payload, { signal })` | `timeouts.jobMs` estoura | `Error` de timeout |
| Plugin (`setup`) | `ctx.signal` | o contexto é descartado (teardown, reload, `setup` que falhou/estourou) | erro do `setup`, ou `PluginHostStateError` no descarte normal |

Depois do prazo, o que o contexto expirado tentar fazer é **recusado**, em vez de executar:

- `reply` de um comando ou listener expirado rejeita com `ContextExpiredError` (`plugin`,
  `operation`, `scope`, `cause` = o erro de timeout) e sai uma linha `warn` com o plugin e o
  comando/evento. Vale também para o `reply` guardado antes do prazo (`const r = c.reply`).
- `send`, `storage` e `scheduler.at`/`cancel` do `PluginContext` descartado rejeitam igual.
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

1. Cria o logger e (sem `storage`) avisa que os dados estão em memória.
2. Assina os eventos do transport e empilha os ganchos de parada internos.
3. Carrega os plugins: coleta (`plugins` + `pluginDirs`) → config → `setup` de cada um → tabela
   de boot no log → checagem de conflito de comando.
4. **Só se o boot dos plugins deu certo**, chama `transport.connect()`; conectado, liga a
   reconexão automática.
5. Liga o scheduler (dispara os jobs vencidos no downtime) e passa a `running`.

Plugin quebrado (conflito de comando, manifesto inválido, ciclo, `pluginDirs` ilegível) derruba
o boot **antes** de o transport abrir sessão: sem QR nem handshake à toa. Mensagens que chegam
durante o handshake aguardam na fila de entrada e são processadas no fim do boot; se o boot
falha, são descartadas.

**Falha no boot**: o bot roda o shutdown e termina em `stopped`. Se a falha foi dos plugins, o
transport nunca conectou e o `disconnect()` não é chamado. Se foi do `connect()`, o shutdown
inclui o `disconnect()`, porque o transport pode ter conectado pela metade (o adapter precisa
tolerar isso). O `start()` rejeita com o erro do boot; se o encerramento também falhar, com um
`AggregateError` cujo primeiro item é esse erro.

**`stop()` durante o `start()`**: o `stop()` espera o boot assentar e então encerra; o `start()`
pendente rejeita com `BotStateError`, porque o bot nunca chegou a `running`.

## Shutdown gracioso (`stop`)

`stop()` roda os ganchos de parada em **LIFO** (quem registrou por último desce primeiro), depois
`transport.disconnect()` e, por fim, `storage.close()`. Os ganchos internos, registrados no
`start()`, ficam no topo da pilha e rodam nesta ordem:

| # | Gancho | Prazo | O que faz |
| --- | --- | --- | --- |
| 1 | `transporte` | 2 s | Para de ouvir o transport (nada novo entra) e cancela a reconexão (nenhum timer sobra) |
| 2 | `fila-de-entrada` | 5 s | Drena: as mensagens já aceitas terminam de ser processadas |
| 3 | `plugins` | 10 s | `teardown` de cada plugin, na ordem inversa da carga |
| 4 | `scheduler` | 5 s | Desarma o timer e espera os jobs em andamento |
| 5 | `fila-de-saida` | 5 s | Drena os envios; estourado o prazo, descarta o resto (`close({ drain: false })`) |
| — | ganchos do app registrados **antes** do `start()` | | |
| — | `transport.disconnect()` | sem prazo | |
| — | `storage.close()` | sem prazo | só se o bot chegou a dar `start()` |

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
| `clean-session` sem `clearSession` | loga em `error` que a sessão precisa de novo pareamento e para o bot (`stop()`) |

- Um `connect()` de reconexão que falha conta como queda (`connection-lost`): a política decide
  de novo, com a tentativa seguinte do backoff.
- Há no máximo um timer de reconexão por vez, e nenhum sobrevive ao `stop()`. O `closed` que o
  próprio `disconnect()` do shutdown gera não reconecta.
- `connection.qr` conta para o limite de QRs da política, vai para o log em `info` (campo `qr`) e
  para o barramento (um plugin pode desenhar o QR).
- `connection.status`/`connection.qr` também chegam aos listeners.

```ts
createBot({
  transport,
  storage,
  reconnection: {
    maxReconnectAttempts: 5,
    backoff: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
    clearSession: () => storage.authState('principal').clear(),
  },
});
```

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

## Várias instâncias

Duas chamadas a `createBot` não compartilham nada — roteador, barramento, filas, scheduler,
registry de serviços, logger e storage padrão são da instância. A mesma `PluginDefinition` pode
servir aos dois bots: cada um monta o próprio contexto. É o caminho para multi-sessão
([ADR 0004](../../../docs/adr/0004-uma-sessao-por-processo.md)).
