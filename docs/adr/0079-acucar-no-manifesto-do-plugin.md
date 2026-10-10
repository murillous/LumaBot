# ADR 0079 — Açúcar no manifesto do plugin: `commands`, `on` e o `run` que devolve texto

**Status:** Aceito (2026-10-10) · Detalha **D16** ([ADR 0016](0016-manifesto-do-plugin.md)) e
**D22** ([ADR 0022](0022-kit-de-autor.md)), antes do 1.0 (**D27**) · Sobre o formato de comando
dos ADRs [0060](0060-resposta-esperada.md), [0062](0062-acoes-e-botoes.md),
[0063](0063-prefixo-por-chat.md) e [0064](0064-comandos-nativos.md)

## Contexto

O `ping` do `apps/lumabot` tinha 18 linhas para uma regra de uma: `definePlugin`, `setup`,
`ctx.commands.add`, `command({...})`, `run` assíncrono com `await c.reply('pong')` e
`requires: ['send.text']` (#296). Quem escreve plugin em JavaScript, sem o compilador para guiar,
sente mais essa cerimônia. A investigação respondeu aos quatro pontos da issue:

- **`run` que devolve texto.** O `onReject` já devolve o texto da recusa. O `run` era tipado
  `=> unknown` e o retorno, ignorado. No repositório, o padrão `run: (c) => c.reply('x')` aparece
  em dezenas de testes e devolve a `MessageKey` do envio. Um tipo de retorno fechado
  (`MessageText | void`) quebraria esse padrão.
- **`commands` e `on` declarativos.** O comando e o listener fixos não dependem de nada que só
  existe no `setup`. O que depende (config, storage, envio) chega pelo contexto do plugin, que dá
  para passar como argumento. A lista no manifesto fica conhecida sem rodar o plugin: serve ao
  `create-zapforge-plugin` (#121), à doc gerada (#125) e ao menu nativo (ADR 0064).
- **`requires` deduzido.** O `requires` só é conferido no boot, contra o transport. Um comando
  declarado pode responder texto, então exige `send.text`. O resto (mídia, reação, `ctx.send`) é
  dinâmico: não dá para deduzir sem executar.
- **`isolatedDeclarations`.** O pacote publicável anota o export com `: PluginDefinition`. Um
  `run(c, plugin)` com `plugin.config` tipado, declarado como propriedade de função, fica
  contravariante no parâmetro, e o plugin com config deixa de caber na anotação larga.

Alternativas consideradas:

- **Retorno do `run` fechado em `MessageText | void`.** Pegaria o retorno acidental, mas quebraria
  o `run: (c) => c.reply('x')` e o `run: (c) => c.expectReply('passo')`, usados em toda parte.
- **Açúcar só no `definePlugin`**, compondo um `setup` novo. O plugin em objeto puro, achado pelo
  `pluginDirs`, não passa pelo `definePlugin`, e o comando sumiria do manifesto como dado.
- **Comando declarativo sem o contexto do plugin.** A forma curta serviria só a respostas fixas.
  Qualquer comando com storage ou config voltaria ao `setup`.
- **Opções de listener no `on`** (`{ priority, quoted, listener }`). Dois jeitos de escrever o
  mesmo listener no manifesto, para um caso que o `setup` já cobre.
- **`send.text` obrigatório em todo transport**, tornando o `requires` redundante. Mudaria a
  validação do `createBot` e recusaria transports de teste que hoje sobem sem capabilities.

## Decisão

- **`commands` no manifesto:** objeto nome → `PluginCommand`, que é o `CommandDefinition` sem
  `name` (vem da chave) e com `run(c, plugin)`: o contexto do comando e o contexto do plugin, o
  mesmo do `setup`.
- **`on` no manifesto:** objeto evento → listener `(e, plugin)`. Um por evento, sem opções.
- **`setup` opcional** quando há `commands` ou `on`. Sem nenhum dos três, o manifesto é inválido.
- **Um caminho só.** O host registra os declarados com `ctx.commands.add` e `ctx.events.on` na
  fase de `setup`, antes do `setup` do plugin. Prazo, recusa, teardown, reload e conflito de nome
  são os da forma longa. O `setup` já vê os declarados em `ctx.commands.list()`.
- **O `run` que devolve texto responde**, em qualquer comando, inclusive os do `setup`. String ou
  árvore `fmt` vira `ctx.reply(texto)`, dentro do prazo do comando, como terminar o `run` com
  `await ctx.reply(texto)`. Qualquer outro valor é ignorado. O tipo segue `unknown`.
- **`send.text` implícito** no plugin que declara `commands`: o boot o soma ao `requires`.
- **Validação para quem escreve em JS.** O `definePlugin` e o boot recusam, com
  `PluginManifestError`, o comando sem `run`, o `name` dentro do comando, nome ou alias inválido,
  `aliases` que não é lista, `onReject` que não é função e evento desconhecido no `on`. O nome do
  evento é conferido contra uma lista de runtime amarrada ao tipo `BotEvents`.
- **Plugin em objeto puro.** O `pluginDirs` reconhece como plugin o export com `name` e `setup`,
  `commands` ou `on`.
- **Bivariância de propósito.** O `run` do `PluginCommand` é declarado como método, e o listener
  do `on`, pelo mesmo truque. Assim, `export const p: PluginDefinition = definePlugin({...})`
  aceita o plugin com config tipada. O tipo estreito só importa dentro do plugin.

## Consequências

- O `ping` cai para uma linha de comando: `commands: { ping: { description, run: () => 'pong' } }`.
- Um `run` que devolvia uma string por acaso passa a responder com ela. É mudança de
  comportamento antes do 1.0: entra no changeset.
- Os tipos `PluginCommand`, `PluginListener` e `PluginListeners` saem em `@zapforge/core`.
- O caminho quente ganha um teste de tipo no retorno de cada comando. O benchmark não mostrou
  diferença fora do ruído.
- Os guias do M3-4 (#122) e o template do #121 ainda não existem: nascem com a forma curta.
- Fica de fora: opções no `on`, `onReject` com o contexto do plugin e resposta pelo retorno do
  listener. Entram por adição se fizerem falta.
- O transport tem a mesma cerimônia (emissor, stubs de capability, `Set` de capabilities). Fica
  para um ADR próprio, sobre um `defineTransport`.
