# ADR 0074 — Trava de sessão entre processos

**Status:** Aceito (2026-10-09) · Detalha **D36** ([ADR 0036](0036-escopo-de-sessao.md)) e
**D14** ([ADR 0014](0014-storage-port-sqlite-postgres.md)) · Segue **D04**
([ADR 0004](0004-uma-sessao-por-processo.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O ADR 0036 impede a mesma sessão de rodar duas vezes em dois níveis. No mesmo processo, o
`claimSession` recusa um segundo bot no mesmo objeto de storage. Entre processos, a proteção é o
`replaced` do WhatsApp: o servidor derruba a conexão antiga. A revisão de multiplataforma (#282)
mostrou que esse segundo nível vale só para o WhatsApp:

- O **Discord** aceita o mesmo token em várias conexões de gateway. Dois processos com o mesmo
  bot conectam, e os dois respondem.
- O **web** não tem servidor que derrube a conexão antiga.
- Com o mesmo nome de sessão em plataformas diferentes, os processos dividem o KV dos plugins, o
  `$scheduler` (o job dispara duas vezes) e o `authState(session)`, e as credenciais de
  transports diferentes se misturam.

A investigação confirmou o problema:

- **O `StoragePort` não tem operação atômica.** O KV só tem `get`/`set`/`delete`. Uma trava feita
  em cima dele teria corrida entre o `get` e o `set` de dois processos.
- **O `claimSession` vive no objeto de storage** (um `Symbol` pendurado nele), então não vê outro
  processo, nem outra conexão ao mesmo banco no mesmo processo.
- **O storage em memória não precisa de trava**, porque nenhum outro processo o enxerga. Além
  disso, os testes de bot com memória rodam `vi.runAllTimersAsync()` e `getTimerCount() === 0`
  com o bot ligado. Um timer de renovação sempre ativo quebraria esses testes.

Alternativas consideradas:

- **Trava por compare-and-set genérico no KV** (`kv.compareAndSet`). Serviria a outros usos, mas
  o core teria de medir a validade com o próprio relógio, e processos em máquinas diferentes
  sobre o mesmo Postgres discordariam do horário.
- **Métodos de trava obrigatórios no `StoragePort`**, com a memória travando também. O timer
  ficaria vivo em todo bot com memória, e os testes existentes teriam de mudar, sem ganho
  nenhum: a memória é de um processo só.
- **Falhar o `start()` na hora** com a trava ocupada. Depois de um crash, a trava fica presa até
  vencer, e um supervisor que reinicia sem backoff entraria em laço de falha durante esse tempo.
- **Seguir rodando com a trava perdida**, só com aviso no log. Dois processos responderiam em
  dobro, que é o defeito que se quer evitar.
- **Nome do transport no namespace e no auth.** Plataformas diferentes com o mesmo nome de sessão
  passariam a coexistir, mas o formato dos dados e o ADR 0036 mudariam. Um nome de sessão por
  bot já resolve.
- **Só documentar.** Descartado na issue: no Discord, a consequência é resposta duplicada.

## Decisão

- **Trava com validade no `StoragePort`**: `acquireLease?(name, owner, ttlMs): Promise<boolean>`
  e `releaseLease?(name, owner): Promise<void>`. `acquireLease` grava `owner` como dono por
  `ttlMs` e devolve `true` se a trava estava livre, vencida ou já era dele (é assim que se
  renova), e `false` se outro dono a tem dentro da validade. Ela é atômica entre processos, e o
  **adapter mede a validade com o relógio dele** (no Postgres, o `now()` do servidor).
  `releaseLease` só libera a trava do próprio dono.
- **Opcional, mas a suíte de contrato cobra.** O storage em memória não implementa a trava. Um
  adapter cujo banco pode ser dividido precisa implementá-la, e a suíte de contrato falha sem ela,
  a menos que o adapter declare `processLocal: true` nas opções. Assim um Postgres que esqueça a
  trava falha na suíte.
- **O bot trava `session:<sessão>` no `start()`**, antes dos plugins (o `setup` já grava e agenda
  jobs). O dono é um UUID por bot. A trava vale por **30 s** e é renovada a cada **10 s**, por um
  timer que não segura o processo (`unref`).
- **Trava ocupada no `start()`: espera até uma validade.** O bot tenta a cada 10 s, por até 30 s,
  e só então falha com `BotConfigError`. Logo depois de um crash, o restart sobe sozinho; uma
  instância duplicada de verdade falha em até 30 s, antes de conectar. O `stop()` durante a espera
  aborta o `start()` na hora.
- **Trava perdida com o bot rodando**: se a renovação devolve `false`, outro processo assumiu
  depois de a trava vencer (pausa longa, máquina suspensa). O bot loga em `error` e para, como no
  `giveUp` da reconexão. Uma falha de I/O na renovação só loga em `warn`: a trava ainda vale por
  mais duas renovações, e o próximo tick tenta de novo.
- **O `stop()` libera a trava** antes de fechar o storage, depois de esperar a renovação em
  andamento. Assim outro processo sobe na hora, sem esperar a validade. Nenhum timer sobrevive ao
  `stop()`.
- **Por nome de sessão, sem olhar o transport.** Discord e WhatsApp com a mesma sessão no mesmo
  banco: o segundo falha no `start()`, e o erro manda dar um `session` diferente a cada bot.
  Namespaces e auth state não mudam.
- O `claimSession` continua: no mesmo processo, ele recusa na hora e decide quem fecha o storage
  compartilhado.

## Consequências

- Mudança aditiva no contrato (dois métodos opcionais). O `@zapforge/storage-sqlite` ganha a
  tabela `leases` numa migration nova (schema 2), aplicada sozinha no boot.
- Quem roda a suíte de contrato com um adapter de um processo só passa `processLocal: true`. Foi
  a única mudança em teste existente (`memory.test.ts`).
- Custo fora do caminho quente: uma escrita no banco a cada 10 s por bot. A mensagem não paga
  nada.
- Disponibilidade depois de um crash: a sessão volta em até 30 s.
- Um bot com storage em memória não tem trava entre processos, e nem precisa dela.
- O `replaced` do WhatsApp continua valendo como proteção extra: com storages diferentes (um
  arquivo por processo), só ele percebe o mesmo número em dois lugares.
