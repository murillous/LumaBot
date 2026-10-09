# ADR 0060 — Resposta esperada: conversa com estado sem segurar o chat

**Status:** Aceito (2026-10-09) · Detalha **D12** ([ADR 0012](0012-pipeline-de-3-estagios.md)) e
**D42** ([ADR 0042](0042-handler-lento-segura-o-chat.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O plugin não tinha como fazer uma pergunta e tratar a resposta (#274). Exemplo: "!notas" → "De
qual aluno?" → "Maria" → notas da Maria. O chatbot de ERP e de gestão escolar é, na maior parte,
esse tipo de conversa guiada. O fallback em texto dos botões (#275) também depende disso, porque o
usuário responde "1" ou "2".

O caminho óbvio trava o chat. A fila de entrada processa uma mensagem por chat por vez, e a tarefa
da mensagem só termina quando o comando ou os listeners terminam (D42). Um `run` que faz `await`
na próxima mensagem do mesmo chat espera uma tarefa que está na fila atrás dele. Ele fica preso até
o `commandMs` estourar.

Sem suporte no core, cada plugin guardaria o passo no storage e o leria num listener de `message`.
Isso não impede o roteador: uma resposta que casa um comando vira comando. Também não evita a
disputa: o `claim()` do barramento só ordena listeners, e dois plugins com estado próprio
consumiriam a mesma mensagem.

Alternativas consideradas:

- **Estado persistido no storage desde já.** A conversa sobreviveria a restart e a réplicas, mas
  custaria I/O em toda mensagem de quem tem conversa aberta e exigiria um formato de storage antes
  de existir um caso que precise dele.
- **Sem suporte no core** (storage e listener em cada plugin). Foi descartada pela disputa entre
  plugins e porque o roteador ficaria na frente.
- **Comando digitado tratado como resposta.** O passo decidiria tudo, mas o usuário só sairia do
  fluxo pelo que o plugin tratasse ou pelo TTL.
- **Comando roda e a espera continua.** O comando passaria, mas o fluxo antigo pegaria a próxima
  mensagem comum, que o usuário já não associa à pergunta.
- **Várias esperas por pessoa, em fila ou para todas.** Reabriria a disputa que a issue quer
  evitar.
- **Primeira espera vence, e registrar sobre uma viva lança erro.** Todo plugin teria de tratar o
  erro, e quem perde é sempre o fluxo que o usuário acabou de pedir.
- **Opção para qualquer pessoa do grupo responder.** Não há caso concreto hoje. Pode entrar
  depois, como opção aditiva.
- **`onExpire` no passo.** Seria mais um ponto com timer, prazo e `plugin.error`. Também pode
  entrar depois sem quebrar a API.
- **Palavra "cancelar" reservada no kernel.** Dependeria de idioma e conflitaria com o prefixo
  vazio (#276).

## Decisão

- O plugin define passos nomeados no `setup` com **`ctx.conversations.define(step, handler)`**.
  Um nome vazio ou repetido no mesmo plugin lança `TypeError`.
- O handler registra a espera com **`expectReply(step, { data?, ttlMs? })`**, síncrono, e
  termina. Ele existe nos contextos de comando (`run` e `onReject`), de listener de mensagem e do
  próprio passo, para encadear perguntas. O plugin só aponta para os próprios passos. Um passo
  desconhecido lança `TypeError`, e um `ttlMs` inválido (não finito, ≤ 0 ou acima do teto do
  `setTimeout`) lança `RangeError`. `data` é `JsonValue`, com padrão `null`. `ttlMs` tem padrão de
  5 minutos.
- A chave é **(chat, remetente)**, em qualquer tipo de chat. Em grupo, outra pessoa não responde
  pela primeira.
- Há **uma espera por chave**. Registrar de novo, do mesmo plugin ou de outro, substitui a
  anterior.
- O `Bot` consulta a espera **antes do roteador**, só para `message`, depois dos middlewares. A
  espera é retirada nesse momento, de qualquer forma:
  - se o texto de trabalho casa um comando registrado, a espera é descartada e o comando roda;
  - senão, a mensagem vai ao passo e para ali, sem passar pelo roteador, pelos listeners de
    `message` ou pelo evento `command`.
- O passo roda dentro da tarefa da fila do chat, com o **prazo do comando** (`commandMs`) e um
  `Deadline` filho do de vida do plugin, como o comando (ADR 0033). Estourado o prazo, sai
  `StepTimeoutError`. Uma falha vira `plugin.error` com **`phase: 'step'`** e `event` = nome do
  passo.
- O contexto do passo traz `message`, `text`, `reply`, `react`, `log`, `signal`, `step`, `data` e
  `expectReply`. Como o `reply`, um `expectReply` feito depois do prazo ou do descarte do plugin
  lança `ContextExpiredError`.
- A expiração é **silenciosa**: um timer por espera, sem manter o processo vivo (`unref`), a
  remove.
- O estado fica **em memória** na v1. O `dispose` do plugin (teardown e reload) remove os passos e
  as esperas dele. O shutdown descarta as que sobrarem e recusa esperas novas, e nenhum timer
  sobrevive ao `stop()`.
- O `settled()` não espera o TTL, porque a espera não é trabalho em andamento. O passo já conta,
  porque roda na fila do chat.

## Consequências

- Mudança aditiva no `PluginContext` (`conversations`), no `CommandContext`, nos campos dos
  listeners de mensagem (`expectReply`) e nos exports (`StepTimeoutError` e os tipos). O
  `PluginErrorEvent.phase` ganha `'step'`. Quem faz `switch` exaustivo sobre a fase precisa tratar
  o valor novo.
- O roteador usado fora do `Bot` não cria `expectReply`, como já não cria `signal`.
- Custo por mensagem: uma checagem de tamanho do mapa quando não há conversa aberta. Com uma
  conversa aberta, há uma busca por chave e, se houver espera, um `match` a mais do roteador.
- Não depende de capability. Funciona em qualquer transport, inclusive no `FakeTransport` do kit,
  sem mudança.
- Um restart perde as conversas em andamento, e o usuário recomeça. Como o passo é nomeado e o
  `data` é JSON, uma espera pode ir ao storage depois (réplicas, restart) sem mudar a API.
- O fallback em texto dos botões (#275) usa o mesmo registro pelo lado do kernel.
