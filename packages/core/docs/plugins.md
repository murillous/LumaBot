# Plugins: manifesto, loader e lifecycle

Toda feature do bot é um plugin ([ADR 0006](../../../docs/adr/0006-luma-e-um-plugin.md)); o core
não importa nenhuma. O loader junta os plugins da config e das pastas, valida o manifesto,
decide quem carrega, ordena e roda `setup`/`teardown` com prazo
([ADRs 0005](../../../docs/adr/0005-plugins-no-mesmo-processo.md),
[0007](../../../docs/adr/0007-plugins-via-npm-e-pasta.md),
[0016](../../../docs/adr/0016-manifesto-do-plugin.md)).

## Declarar um plugin

```ts
import { command, definePlugin } from '@zapforge/core';
import { z } from 'zod';

export const sticker = definePlugin({
  name: 'sticker',                              // kebab-case, único no bot
  version: '1.2.0',                             // semver do plugin
  engine: '^1.0.0',                             // faixa do @zapforge/core — obrigatório
  requires: ['media.download', 'send.sticker'], // capabilities do transport
  transports: ['baileys'],                      // opcional: fixa o(s) transport(s)
  dependsOn: { 'user-names': '^1.0.0' },        // opcional: plugin → faixa semver
  after: ['logger-extra'],                      // opcional: carrega depois, se existir
  priority: 0,                                  // opcional: maior carrega antes

  config: z.object({ quality: z.number().min(1).max(100).default(80) }),
  messages: { needMedia: 'Mande ou responda uma imagem/vídeo 🙂' },

  setup(ctx) {
    ctx.config.quality;          // number — sai de z.output do schema
    ctx.plugin.messages.needMedia; // só as chaves declaradas em `messages`
    ctx.commands.add(command({ name: 'sticker', run: async (c) => { /* ... */ } }));
    // Papel que qualquer plugin pode exigir no comando (ver commands.md, "Papéis custom").
    ctx.roles.define('moderador', (c) => moderadores.has(c.message.sender.id));
  },

  teardown(ctx) { /* libera o que o setup abriu fora do ctx */ },
});
```

`definePlugin` valida o manifesto na hora e lança `PluginManifestError` com **todos** os
problemas encontrados. Regras:

| Campo | Regra |
| --- | --- |
| `name` | kebab-case minúsculo começando por letra (`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`), até 64 caracteres. Vira chave de `disabledPlugins`, namespace de storage e prefixo de rota, então não muda entre versões. |
| `version` | semver exato (`1.2.0`, `1.0.0-beta.1`). |
| `engine` | faixa semver, obrigatória, conferida contra `CORE_VERSION`. |
| `requires` | capabilities de `CAPABILITIES`; o TypeScript já recusa nome errado. |
| `transports` | lista não vazia de nomes de transport. |
| `dependsOn` | nome de plugin → faixa semver; não pode citar o próprio plugin. |
| `after` | nomes de plugin; não pode citar o próprio plugin. |
| `priority` | número finito; padrão 0. |

Faixas aceitas: `^`, `~`, `>=`, `>`, `<=`, `<`, `=`, curingas (`*`, `x`, `1.x`, `1.2`),
comparadores separados por espaço (E) e `||` (OU) — a semântica do npm, inclusive a de
pré-release: `^1.0.0` não aceita `1.1.0-beta`. Faixas com hífen (`1.0.0 - 2.0.0`) não são
aceitas.

## Fontes: config e `pluginDirs`

O `Bot` faz isto no `start()` com `plugins` e `pluginDirs` da config. Por dentro (interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md))):

```ts
import { collectPlugins } from '#plugin/sources.ts';
import { sticker } from '@zapforge/plugin-media';

const plugins = await collectPlugins({
  plugins: [sticker],          // pacotes npm: o app importa e passa
  pluginDirs: ['./plugins'],   // relativo a `cwd` (padrão: process.cwd())
});
// → PluginEntry[]: { definition, origin } — origin é 'config' ou o caminho do módulo
```

As duas fontes dão a mesma `PluginDefinition`; a lista da config vem primeiro, depois cada
pasta na ordem dada. Convenção de pasta (`discoverPlugins(dir)`):

- cada arquivo `.ts`/`.mts`/`.js`/`.mjs` e cada subpasta com `index.*` é um módulo de plugin;
- todo export (nomeado) com `name` string e `setup` função entra — um módulo pode exportar
  vários; o mesmo objeto exportado duas vezes conta uma;
- ficam de fora nomes começando com `_` ou `.`, `*.test.*`/`*.spec.*` e `.d.ts` — use `_` para
  helpers e pastas auxiliares;
- a ordem é a alfabética dos nomes, nunca a do sistema de arquivos;
- módulo sem plugin, subpasta sem `index.*`, pasta ilegível ou import que lança são
  `PluginDiscoveryError` (erro no boot, com o caminho e a causa).

`.ts` na pasta roda pelo type stripping do Node 24 — só sintaxe apagável.

## Subir e derrubar: `createPluginHost`

O `Bot` faz tudo isto no `start()`/`stop()` ([Bot → Plugins](bot.md#plugins)), com a fábrica de
contexto ligada aos serviços da instância. Por dentro (interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md))):

```ts
import { createPluginHost } from '#plugin/host.ts';

const host = createPluginHost({
  plugins,                                  // de collectPlugins
  transport,                                // { name, capabilities }
  disabledPlugins: ['sticker'],
  log,                                      // Logger
  createContext: (plugin) => ({             // quem monta o ctx é o Bot
    context: buildContext(plugin),
    dispose: () => removeEverythingFrom(plugin.name),
  }),
  setupTimeoutMs: 10_000,                   // padrão
  teardownTimeoutMs: 5000,                  // padrão
});

const table = await host.start();           // tabela de boot
// ...
const errors = await host.stop();           // PluginLifecycleError[]
```

### Boot (`start`)

1. **Erros de boot** — rejeitam `start()` antes de qualquer `setup`:
   `PluginManifestError` (manifesto malformado), `PluginConflictError` (dois plugins com o
   mesmo `name`, com as duas origens) e `PluginCycleError` (ciclo em `dependsOn`/`after`, com o
   caminho: `a → b → c → a`, onde `→` = "depende de / carrega depois de").
2. **Ordem** (`sortPlugins`): toposort com `dependsOn` e `after` como arestas; entre os
   prontos, `priority` maior primeiro e, no empate, a ordem de declaração. Nome citado que não
   existe não cria aresta. A ordenação considera todos os plugins, inclusive os desabilitados:
   ciclo é erro do código, não da config.
3. **Quem carrega**, na ordem, parando no primeiro motivo:

   | Motivo (`reason.kind`) | Quando |
   | --- | --- |
   | `disabled` | nome em `disabledPlugins` (nome desconhecido ali gera `warn`) |
   | `engine` | `CORE_VERSION` fora da faixa `engine` |
   | `transport` | `transports` declarado e sem o nome do transport ativo |
   | `capabilities` | `requires` com capabilities que o transport não tem (lista todas) |
   | `dependency-missing` | `dependsOn` cita plugin que não existe |
   | `dependency-version` | a versão da dependência não satisfaz a faixa |
   | `dependency-skipped` | a dependência existe mas foi ignorada — propaga em cadeia |
   | `setup-failed` | a fábrica de contexto ou o `setup` lançou ou estourou o prazo |

4. **Setup**: para cada compatível, `createContext(plugin)` e depois `setup(ctx)`, cada um com
   `setupTimeoutMs`. Se falhar, o loader chama `dispose()` (sem `teardown`, que só pareia com
   setup concluído), loga em `error` e marca o plugin — e quem depende dele — como ignorado. O
   boot segue.

A tabela volta de `start()` como dado (`PluginReportEntry[]`, na ordem de carga) e vai para o
log formatada — em `info` se tudo carregou, `warn` se algo foi ignorado —
com os mesmos dados em `fields.plugins`:

```
Plugins: 2 carregado(s), 2 ignorado(s)
  user-names  1.0.0  carregado
  sticker     1.2.0  carregado
  enquete     1.0.0  ignorado (capability ausente no transport: polls)
  resumo      0.3.0  ignorado (dependência ignorada: ai)
```

`host.report()` devolve a tabela atual (reflete reloads).

### Parada (`stop`)

`teardown` e depois `dispose` de cada plugin carregado, na **ordem inversa** da carga, cada
um com `teardownTimeoutMs`. Falha ou timeout de um não impede os outros: `stop()` nunca
rejeita por plugin, devolve as falhas (`PluginLifecycleError` com `plugin`, `phase`,
`timedOut` e `cause`) e as loga. É idempotente e espera um `start`/`reload` em andamento.

`stop(signal)` aceita um `AbortSignal`: abortado, o `teardown` em curso é abandonado e os
seguintes não rodam (cada um vira falha com `timedOut: true`), mas o `dispose` de todos roda.
É o que o `Bot` usa quando o prazo de parada acaba.

### Recarregar um plugin (`reload`)

```ts
const { entry, errors } = await host.reload('sticker');
```

`teardown` → `dispose` → contexto novo → `setup`, só desse plugin. É a primitiva do reload por
mudança de config ([ADR 0017](../../../docs/adr/0017-config-por-plugin-zod.md)): a fábrica lê a
config já atualizada. Vale para plugin carregado ou cujo `setup` falhou (para tentar de novo);
os ignorados por incompatibilidade recusam com `PluginHostStateError`. Quem depende do plugin
não é recarregado. Não há reload de **código** ([ADR 0008](../../../docs/adr/0008-sem-hot-reload.md)).

### A fábrica de contexto

O loader não conhece comandos, eventos, storage nem serviços: recebe
`createContext(plugin) => { context, dispose }`. `dispose` precisa desfazer tudo o que o plugin
registrou pelo contexto. Um `setup` que estoura o prazo continua rodando em segundo plano
(não há como abortar código síncrono/arbitrário); a fábrica deve fazer o contexto recusar
registros depois do `dispose`, para o setup atrasado não deixar nada para trás — a do `Bot` lança
`PluginHostStateError` em `commands.add`, `events.on`, `services.provide` e `scheduler.on`, e
rejeita com `ContextExpiredError` `send`, `storage` (KV e coleções) e `scheduler.at`/`cancel`.

`dispose(reason?)` recebe a falha do `setup` quando ele falhou ou estourou o prazo; a do `Bot` a
usa como `reason` do `ctx.signal`, que aborta no `dispose`.

### Cancelamento cooperativo para autores de plugin

O código do plugin não é interrompido à força: o kernel avisa pelo `signal` e recusa o que o
contexto expirado tentar fazer ([ADR 0033](../../../docs/adr/0033-cancelamento-cooperativo.md),
detalhes em [Bot](bot.md#prazos-e-cancelamento-ctxsignal)).

- `ctx.signal` (no `setup`) aborta quando o contexto é descartado: repasse ao trabalho de fundo
  do plugin (timers, conexões, streams) e pare-o no `abort`.
- `c.signal` (comando), `e.signal` (listener) e `{ signal }` (job) abortam no prazo da execução:
  repasse a `fetch`/SDKs e confira `signal.aborted` antes de efeitos.
- Depois do prazo, o `reply` daquele contexto rejeita com `ContextExpiredError`; depois do
  descarte, `send`/`storage`/`scheduler.at` do plugin também.
- Código síncrono travado (laço, CPU pesada) bloqueia o processo inteiro: nenhum prazo resolve.

## Versão do core

`CORE_VERSION` é a versão conferida contra `engine`. Um teste a compara com o `package.json`:
o PR de versão do changesets precisa atualizá-la junto. `createPluginHost({ coreVersion })`
sobrescreve só em testes.
