# ADR 0064 — Comandos nativos: o transport lê a lista e confirma a interação na hora

**Status:** Aceito (2026-10-09) · Detalha **D37** ([ADR 0037](0037-transport-por-fabrica.md)),
**D42** ([ADR 0042](0042-handler-lento-segura-o-chat.md)) e **D62** ([ADR 0062](0062-acoes-e-botoes.md))
· Parte do kernel multiplataforma ([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O Discord exige registrar os slash commands, o Telegram mostra o menu "/" com o `setMyCommands`,
e o web pode mostrar um menu de comandos (#277). O transport não via a lista de comandos: o
`TransportDeps` trazia só `session`, `auth` e `log`.

A investigação respondeu às perguntas da issue:

- **Quando a lista muda.** No boot, que termina antes do `connect()` (plano §5.3). No reload do
  plugin, que tira os comandos dele e só os recoloca depois do `setup`, alguns ticks depois. E no
  `ctx.commands.add` fora do `setup`, que o contexto vivo aceita. Não existe enable/disable em
  runtime: o `disabledPlugins` vale só no boot. Um aviso a cada mudança faria o reload tirar e
  recolocar os comandos do Discord, que limita a taxa de registro.
- **O shutdown também muda a lista.** O `teardown` tira os comandos de cada plugin. Se o kernel
  avisasse, o transport apagaria o menu da plataforma a cada parada.
- **Prazo.** O Discord exige confirmar a interação em 3 s e aceita respostas por 15 min. O
  Telegram deixa o botão girando até o `answerCallbackQuery`. A fila de entrada serializa por
  chat (ADR 0042), e a de saída tem intervalos fixos. O ADR 0062 já pôs a confirmação do clique
  no transport. O follow-up sai pela fila de saída, e os 15 min do Discord cobrem com folga o
  `commandMs` e os intervalos da fila.
- **`MessageKey` da resposta.** Não muda. O `id` da interação vira o ID da mensagem do comando,
  e o `ctx.reply` a cita. O transport reconhece o ID citado e responde como follow-up. O
  `MessageKey` devolvido é o da mensagem que ele criou.
- **Invocação nativa.** No Discord, o slash command chega estruturado (nome e opções), não como
  texto. O transport não sabe o prefixo do chat (ADR 0063), então montar `!nome args` seria frágil.

Alternativas consideradas:

- **Ler a lista só no `connect()`.** O menu ficaria desatualizado depois de um reload até a
  próxima reconexão.
- **`Transport.setCommands?()` opcional, chamado pelo kernel.** Empurraria a lista em vez de o
  transport assiná-la, e o kernel decidiria quando registrar, decisão que depende da plataforma.
- **Transport emite `message` com `<prefixo>nome args`.** Dependeria do prefixo do chat, que é do
  kernel.
- **Evento novo `command.invoked` no `TransportEvents`.** Duplicaria o caminho do `interaction`,
  que já confirma na plataforma e roda um comando pelo nome.
- **Mostrar todos os comandos a todo mundo.** O menu ofereceria comandos que a pessoa não pode
  rodar.
- **Core filtrar só os de `everyone`.** Perderia o `group-admin` restrito, que o Discord e o
  Telegram sabem mostrar só aos admins.
- **Schema tipado dos argumentos no `CommandDefinition`.** Fica como direção futura: na v1, os
  argumentos são texto livre.

## Decisão

- **`TransportDeps.commands`**, campo aditivo e opcional (ADR 0037), com dois métodos. O
  `createBot` sempre o preenche; o opcional serve a quem monta o `TransportDeps` à mão, como os
  testes de adapter:
  - `list()` devolve os comandos registrados agora, como `CommandInfo` (o mesmo do
    `ctx.commands.list()`: `plugin`, `name`, `aliases`, `description`, `role`);
  - `onChange(listener)` avisa que a lista mudou e devolve a função que desfaz a assinatura.
- **Aviso em lote.** O kernel avisa uma vez ao fim de cada reload, com os dependentes em cascata,
  e uma vez por tick para os `ctx.commands.add` fora de um reload. Não avisa no boot, porque o
  `connect()` vem depois, nem a partir do início do `stop()`. O aviso não traz a lista: o
  transport chama `list()` e compara com o que já registrou antes de chamar a plataforma. Um
  listener que lança, ou cuja promise rejeita, vai para o log do bot.
- **Quando registrar é do transport.** A doc orienta registrar no primeiro `open` e a cada aviso,
  só se a lista mudou.
- **Só o nome no menu.** O alias segue funcionando digitado. O Discord limita a 100 comandos
  globais, e os aliases poluiriam o menu.
- **Papel decide a visibilidade, no transport.** O core passa todos os comandos com o `role`. A
  doc orienta: `everyone` para todos; `group-admin` restrito onde a plataforma permite (permissão
  no Discord, escopo de admins no Telegram); `owner` e papéis custom fora do menu. O kernel checa
  o papel na execução de todo jeito.
- **Invocação nativa pelo `interaction`.** O `Interaction` vira a união de `ActionInteraction`
  (`actionId`, o clique do ADR 0062) e `CommandInteraction` (`command` e `args`). O `command` é o
  nome ou o alias, sem prefixo. O `args` é texto livre, interpretado como o texto depois do
  comando digitado (aspas, `rawArgs`). O kernel roda como o clique num botão de comando: mesma
  fila, middlewares, papel, recusa, evento `command`, e o comando cancela a espera do remetente
  (ADR 0060). A mensagem do comando é de texto, com `/<command> <args>` como texto. Comando que
  não existe mais é descartado com log em `debug`.
- **A confirmação é do transport**, como no ADR 0062: ele confirma a interação na hora (defer no
  Discord, `answerCallbackQuery` no Telegram) e a entrega ao kernel sem pressa. As filas e o
  ADR 0042 não mudam. A resposta do plugin sai pela fila de saída e o transport a envia como
  follow-up. Passado o prazo da plataforma, ele a envia como mensagem comum no chat.

## Consequências

- Mudança aditiva para quem monta o transport: `TransportDeps.commands` é campo novo, e o
  transport que não o lê segue igual. Quem lê `Interaction.actionId` sem estreitar o tipo precisa
  conferir o `actionId` ou o `command` antes: dentro do repositório, só o kernel o lê.
- Os tipos `TransportCommands`, `ActionInteraction` e `CommandInteraction` saem em
  `@zapforge/core/adapter`.
- O `CommandInvocation`, interno ao roteador, aceita `rawArgs` no lugar de `args`.
- O registro de comandos ganha um aviso de mudança. O caminho quente não muda: nada roda por
  mensagem.
- Comando com papel restrito fica fora do menu nativo de quem não o pode rodar. A pessoa ainda
  pode digitá-lo, e o kernel o recusa como antes, com o `onReject`.
- O schema tipado dos argumentos (opções do Discord com tipo, autocomplete) pode entrar depois,
  como campo opcional do `CommandDefinition`, sem mudar o `CommandInteraction`.
