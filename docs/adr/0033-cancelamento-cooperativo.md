# ADR 0033 — Cancelamento cooperativo do código de plugin

**Status:** Aceito (2026-10-07) · Detalha a decisão **D05** ([ADR 0005](0005-plugins-no-mesmo-processo.md))

## Contexto

O ADR 0005 isola cada handler de plugin por try/catch + prazo. Mas o JS não mata uma promise: um
comando, listener, job ou `setup` que estoura o prazo segue rodando em segundo plano. O kernel
libera o chat e reporta `plugin.error`, mas o código atrasado continua chamando APIs externas e,
pior, ainda consegue responder no chat, gravar no storage ou agendar jobs minutos depois, inclusive
depois que o plugin desceu. O plugin também não tinha como saber que o prazo estourou.

Alternativas consideradas: worker threads (descartadas no ADR 0005 pelo custo); atribuir cada
chamada de `ctx.send`/`ctx.storage` à execução de origem por `AsyncLocalStorage` (custo no
caminho quente e efeito surpresa: um recurso criado lazy dentro de um comando herda o contexto
dele e passaria a ser recusado para sempre depois de um timeout); não fazer nada e só documentar.

## Decisão

- **`signal: AbortSignal`** em todo código de plugin com prazo: `CommandContext.signal`,
  `ListenerContext.signal` (todo evento), segundo argumento do handler de job
  (`(payload, { signal })`, compatível com handlers de um parâmetro) e `PluginContext.signal`.
  Comando, listener e job abortam quando o prazo estoura, com `reason` = `CommandTimeoutError`,
  `ListenerTimeoutError` ou `JobTimeoutError`, todos filhos de `ExecutionTimeoutError` (`plugin`,
  `timeoutMs`): o plugin distingue timeout de outro motivo com `instanceof`. O do plugin aborta
  no descarte do contexto (teardown, reload, `setup` que falhou ou estourou o prazo, com o erro
  do `setup` como `reason`).
- O `signal` é abortado pelos **timers de prazo que já existem** (sem timer novo), e o
  `AbortController` só é criado quando alguém lê `signal`.
- O prazo é **por execução**: no barramento, cada listener recebe uma visão própria da emissão
  com o próprio prazo; um listener lento expirar não afeta outro do mesmo evento.
- **Contexto expirado recusa efeitos**: o `reply` de comando/listener expirado e o `send`,
  `storage` (KV e coleções) e `scheduler.at`/`cancel` do `PluginContext` descartado rejeitam com
  `ContextExpiredError` (`plugin`, `operation`, `scope`, `cause` = motivo) e uma linha `warn`, em
  vez de executar. Os registros (`commands.add`, `events.on`, …) seguem lançando
  `PluginHostStateError` depois do descarte.
- **Um registro por falha**: a recusa já loga em `warn`. Se o plugin não tratar a
  `ContextExpiredError` e ela rejeitar o comando, listener ou job depois do prazo, o kernel não
  a loga de novo como erro tardio. Qualquer rejeição tardia de job vai só ao log, sem um segundo
  `plugin.error` (o timeout já saiu), como já acontecia com comando e listener.
- A recusa vale para o que pertence ao contexto expirado. O `ctx.send`/`ctx.storage` que um
  comando usa pelo closure do `setup` são do plugin: só são recusados no descarte dele. Dentro de
  uma execução, o plugin confere `signal.aborted` antes de efeitos.

## Consequências

- Plugin bem escrito para a tempo: repassa o `signal` a `fetch`/SDKs. O kernel deixa de mandar
  resposta atrasada ao chat e de aceitar escrita de plugin que já desceu.
- Contrato novo para autores de plugin, documentado em `docs/bot.md` e nos guias de comandos,
  eventos, scheduler e plugins.
- Custo no caminho quente: uma visão e um `Deadline` por listener por emissão (medido em ~1 µs
  por mensagem num bot com um comando e um listener; sem `AbortController` se ninguém lê o
  `signal`).
- Limite que nenhum prazo resolve: código síncrono travado bloqueia o processo inteiro.
