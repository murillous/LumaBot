# ADR 0035 — Papéis custom nomeados, definidos por plugin

**Status:** Aceito (2026-10-07) · Substitui o trecho "papéis custom via middleware de plugin" do
[ADR 0024](0024-papeis-no-core.md) e a menção a papéis custom no estágio de middlewares do
[ADR 0012](0012-pipeline-de-3-estagios.md)

## Contexto

O ADR 0024 pôs `owner` / `group-admin` / `everyone` no roteador e deixou papéis custom para
"middleware de plugin". A revisão do M1 mostrou dois problemas:

1. O `PluginContext` não tem como registrar middleware: middlewares só existem na config do app.
   Pela visão do ADR 0034 (quem usa o ZapForge escreve plugins, não mexe no app), papel custom
   ficaria sem caminho.
2. Mesmo que o plugin registrasse middleware, middleware é a ferramenta errada para controle de
   acesso: ele roda antes do roteador, então não sabe qual comando foi digitado nem que papel
   esse comando exige. O plugin de papéis teria de reparsear o prefixo e manter a própria tabela
   "comando → papel", duplicando o roteador.

Alternativas consideradas: `ctx.middleware.use()` no `PluginContext` (cumpre o texto do ADR 0024,
mas não resolve o caso e deixa um plugin barrar as mensagens de todos os outros); middleware de
plugin e papéis nomeados juntos (mais API sem consumidor concreto); nenhum mecanismo na v1.

## Decisão

- Um plugin **define papéis nomeados**: `ctx.roles.define('moderador', check)`, onde `check`
  recebe o contexto da mensagem (com `signal`) e devolve `boolean | Promise<boolean>`.
- Qualquer plugin usa o papel no comando: `command({ name: 'ban', role: 'moderador', run })`.
  Os nomes são tipados por declaration merging, como os serviços (ADR 0018):

  ```ts
  declare module '@zapforge/core' {
    interface Roles { moderador: true }
  }
  ```

- O **roteador** avalia o papel, como já faz com os embutidos:
  - `owner` continua superusuário e passa em qualquer papel;
  - a checagem roda com prazo (ADR 0005/0033); erro ou prazo estourado **recusa** o comando
    (fail-closed) e vira `plugin.error` do plugin dono do papel;
  - papel que nenhum plugin carregado define recusa o comando (fail-closed) e loga erro.
- Nomes `owner`, `group-admin` e `everyone` são reservados. Dois plugins definindo o mesmo papel
  é erro no boot (como conflito de serviço). Quem usa um papel de outro plugin declara
  `dependsOn` nele, para carregar depois.
- O papel sai junto com o plugin que o definiu (teardown/reload), como comandos e serviços.
- Middleware continua só na config do app. `ctx.middleware` para plugins fica para quando um
  plugin real precisar interceptar mensagens antes dos outros; até lá, listeners com prioridade e
  `claim()` (ADR 0012) cobrem os casos conhecidos.

## Consequências

- Controle de acesso custom fica inteiro dentro de plugins, sem tocar no app.
- `CommandRole` passa a aceitar os nomes de `Roles`, além dos três embutidos.
- O roteador ganha mais um ponto com código de plugin no caminho da mensagem: precisa de prazo,
  como o `onReject` e a consulta de admin (issue #196).
- Durante o reload do plugin dono do papel, os comandos que o exigem são recusados.
- `docs/commands.md` e o comentário de `CommandRole` deixam de citar middleware para papéis
  custom.
