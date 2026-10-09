# ADR 0062 — Ações e botões: o clique dispara um comando, com fallback em texto numerado

**Status:** Aceito (2026-10-09) · Detalha **D12** ([ADR 0012](0012-pipeline-de-3-estagios.md)),
**D49** ([ADR 0049](0049-evento-de-comando.md)) e **D60** ([ADR 0060](0060-resposta-esperada.md))
· Parte do kernel multiplataforma ([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O plugin tinha duas portas de entrada: o comando por prefixo e o listener de mensagem (#275). Não
havia como enviar botões nem receber o clique. O `OutgoingContent` e o `Reply` não tinham
componentes, e o `TransportEvents` não tinha evento de interação.

Botões existem no Telegram (teclado inline), no Discord (botões e select menus), no WhatsApp
oficial (Cloud API, Twilio, Zenvia) e no web. Para quem usa o chatbot de ERP, eles são a interface
principal. O Baileys não tem botões confiáveis.

A investigação respondeu às perguntas da issue:

- **Forja do clique.** O `callback_data` do Telegram e o clique do web vêm do cliente. Se o botão
  carregasse o comando e os argumentos, o usuário poderia forjar um clique com outros argumentos.
- **Limites.** O `callback_data` do Telegram tem 64 bytes. O Discord aceita 5 linhas de 5
  botões, e o WhatsApp Cloud API, 3 botões ou uma lista de 10 itens.
- **Botão antigo.** Um clique pode chegar dias depois, ou depois de um reload do plugin.
- **Prazo de confirmação.** O Discord exige confirmar em 3 s, e o Telegram deixa o botão girando
  até o `answerCallbackQuery`. A fila de entrada não garante esse prazo (#277).

Alternativas consideradas:

- **Comando e argumentos assinados (HMAC) no botão.** Sobreviveria a restart, mas exigiria um
  segredo na config e não caberia nos 64 bytes do Telegram com argumentos longos.
- **Evento `interaction` livre no barramento.** Os listeners de todos os plugins veriam o
  clique e filtrariam pelo dono. Exigiria um contexto de listener novo, com `reply`. O passo de
  conversa já tem tudo isso e só chega ao plugin dono.
- **Cada plugin mapeia o clique.** Foi descartado na sessão de 2026-10-08: cada plugin repetiria
  o papel, o prazo e a validação.
- **Ações também no `ctx.send`.** No Baileys, o fallback mostraria a lista sem uma pessoa a
  esperar, e ninguém poderia responder com o número. Pode entrar depois, de forma aditiva.
- **Aviso do kernel no clique vencido.** Exigiria um texto fixo na config do bot (ADR 0025). O
  transport já confirmou o clique, e a espera vencida do ADR 0060 também é silenciosa.

## Decisão

- **O plugin anexa ações à resposta.** `ctx.reply(text, { actions })` e `ctx.reply.text` aceitam
  `actions`, uma lista de `MessageAction`:
  - `{ label, command, args? }` roda um comando registrado, de qualquer plugin;
  - `{ label, step, data? }` roda um passo de conversa do próprio plugin (ADR 0060), para o que
    não é comando, como um seletor de data.
- **O clique é o comando.** Ele passa pela fila do chat e pelos middlewares, como uma mensagem.
  Depois roda o mesmo handler, com a mesma checagem de papel e de `accepts`, a mesma recusa e o
  mesmo evento `command`. O `args` chega como veio, e o `rawArgs` é o `args` unido por espaços.
  Num grupo, quem clica é o remetente, e o papel é checado para ele.
- **O passo roda como uma resposta esperada.** Ele recebe o `data` da ação, tem o prazo do
  comando e falha em `plugin.error` com `phase: 'step'`.
- **O botão leva um ID opaco.** O kernel guarda o alvo da ação em memória, sob um ID aleatório de
  16 caracteres, preso ao chat. O transport recebe só `{ id, label }`, em `SendOptions.actions`.
  O clique volta pelo evento `interaction` do transport: `{ id, chat, sender, actionId,
  timestamp }`. O kernel resolve o `actionId` e ignora o que não reconhece.
- **Validade.** O ID vale 24 horas e pode ser clicado mais de uma vez, como um comando digitado
  de novo. Não há timer: o vencido é descartado ao ser consultado e quando entram IDs novos, e o
  kernel guarda no máximo 10.000, descartando os mais antigos. O ID aponta para o nome do comando
  ou do passo, então sobrevive ao reload do plugin. Um restart o perde, como as esperas do
  ADR 0060.
- **Clique vencido, desconhecido ou de outro chat.** O kernel o descarta e loga em `debug`. Vale
  também para comando ou passo que não existe mais.
- **Validação no envio.** `label` vazio, comando não registrado ou passo que o plugin não definiu
  lançam `TypeError` na chamada do `reply`. Uma ação de passo fora do contexto de um plugin
  também lança.
- **Capability `actions`.** Com ela, os botões vão ao transport. O campo opcional
  `Transport.limits.actions` diz quantos cabem numa mensagem.
- **Fallback em texto numerado.** Sem a capability, ou com mais ações do que o limite, o kernel
  acrescenta ao texto a lista `1. rótulo`, uma por linha, e registra uma resposta esperada
  (ADR 0060) para o remetente da mensagem respondida, com a validade padrão de 5 minutos:
  - um número da lista roda a ação, como o clique;
  - outro texto segue o fluxo normal, e a espera acaba;
  - um comando digitado também cancela a espera;
  - uma espera nova do remetente no chat, de um plugin ou de outro menu, substitui a anterior.
- **Texto dividido.** Os botões vão só na última parte de um texto acima do limite (ADR 0061),
  onde a leitura termina.
- **A confirmação é do transport.** Ele confirma a interação na hora (defer no Discord,
  `answerCallbackQuery` no Telegram) e a entrega ao kernel sem pressa. O `id` da interação vira o
  ID da mensagem do clique. O `ctx.reply` a cita, e o transport decide como responder (follow-up
  no Discord, mensagem nova no Telegram). O resto fica com #277.
- **O evento é do kernel.** O `interaction` não entra nos `BotEvents`: o plugin recebe o clique
  como comando ou passo, nunca o ID cru.

## Consequências

- Mudança aditiva: capability `actions`, `SendOptions.actions`, `TextLimits.actions`, evento
  `interaction` no `TransportEvents`, opção `actions` no `ctx.reply` e os tipos novos
  (`MessageAction`, `CommandAction`, `StepAction`, `ReplyTextOptions`, `OutgoingAction`,
  `Interaction`). Um transport existente não declara `actions` e recebe o texto numerado.
- O clique conta no `rateLimit` e no `chatFilter`, e o `ignoreBots` o barra, porque passa pelos
  middlewares. A mensagem do clique é de texto, com o `label` como texto.
- O `CommandRouter.dispatch` ganha um segundo parâmetro opcional, o comando a rodar sem casar o
  texto.
- No Baileys, só quem recebeu a resposta responde com o número. Num transport com botões, num
  grupo, qualquer pessoa clica, e o papel do comando decide.
- Custo por mensagem: nenhum sem ações. Com ações, um ID aleatório e uma entrada no mapa por
  botão.
- As ações podem ir ao `ctx.send` e ao storage (réplicas, restart) depois, sem mudar a API. O
  storage persistiria o mesmo alvo que fica hoje em memória.
