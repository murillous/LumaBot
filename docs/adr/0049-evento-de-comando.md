# ADR 0049 — Evento `command`: o plugin observa o comando que consumiu a mensagem

**Status:** Aceito (2026-10-07) · Detalha **D12** ([ADR 0012](0012-pipeline-de-3-estagios.md))
e **D40** ([ADR 0040](0040-acoes-do-transport-no-plugin.md))

## Contexto

O comando que casa **consome** a mensagem (D12): ela não chega aos listeners de `message`, nem
quando o comando é recusado ou falha. O middleware é só do app, e o roteador devolve o
`DispatchResult` ao `Bot`, que só o usa para a resposta da recusa e para o `plugin.error`. Um
plugin não tinha como saber que uma mensagem virou comando (#254).

O legacy faz trabalho transversal sobre toda mensagem, comandos inclusive, e os plugins que o
portam precisam de um caminho:

- `SpontaneousHandler.trackActivity` conta toda mensagem de grupo, antes do roteador, para medir
  a atividade (M5-3). Um `!sticker` conta.
- As métricas de uso (`incrementMetric`) saem, em quase todos os casos, do próprio plugin que
  rodou o comando. Isso já funciona. O que falta é a contagem que atravessa plugins, como o total
  do dashboard (M5-4).
- `trackUsers` guarda o nome de todo remetente. Isso é papel do `contact.updated` (D40), desde
  que o adapter o emita também na primeira vez que vê um contato (a confirmar no M2-1.6).

A investigação mostrou que toda mensagem que passa pelos middlewares termina em exatamente um de
dois lugares: num comando, que a consome, ou no evento `message`. Basta tornar o primeiro
observável.

Alternativas consideradas:

- **Evento antes do roteador** (`message.received`, ou `{ includeCommands: true }` no
  `on('message')`): redundante com `message` + `command`, e custa uma emissão a mais por
  mensagem no caminho quente.
- **Middleware por plugin**: dá poder demais, porque um plugin poderia barrar as mensagens dos
  outros.
- **Manter e documentar**: as métricas viriam de `bot.stats()` e a atividade ignoraria
  comandos, diferente do legacy.

## Decisão

- Novo evento `command`, só de observação, com payload `CommandEvent`:
  `{ plugin, name, invokedAs, status, message }`. `status` é `ran`, `rejected` (papel ou
  `accepts`) ou `failed`. A falha continua saindo em `plugin.error`, com o erro. O
  `command` não repete o erro: diz só que o comando rodou e como terminou.
- Sai para todo comando que casou, depois de ele terminar: depois do `run`, ou depois do
  `onReject` com a resposta da recusa já enfileirada, ou depois do `plugin.error`. Mensagem que
  nenhum comando consumiu não gera `command`, porque já vai para `message`.
- O payload não é uma `Message`, então o contexto do listener não tem `reply`, `react` nem
  `text`: o evento não compete com o comando pela resposta. Quem quiser agir no chat usa o
  `ctx.send` do plugin.
- O `Bot` espera os listeners, como no `message`: o observador segura o chat (D42) e entra no
  `bot.settled()` (D44). Sem listeners, a emissão volta na hora, sem custo no caminho quente.
- Fica de fora: middleware por plugin, evento de log (o M5-4.1 decide o que o dashboard
  precisa) e evento antes do roteador.

## Consequências

- Quem precisa ver toda mensagem assina `message` e `command`. O plugin-spontaneous conta a
  atividade como o legacy, e o dashboard conta comandos de todos os plugins.
- Um listener lento de `command` atrasa a próxima mensagem do chat, como um de `message`. A
  receita de soltar o trabalho longo (ADR 0042) vale igual.
- O consumo do D12 não muda: comando continua parando a mensagem antes dos listeners de
  `message`.
- Se o M2-1.6 não emitir `contact.updated` na primeira aparição de um contato, o
  plugin-user-names (M4-3) volta a precisar de um caminho, e um ADR novo trata disso.
