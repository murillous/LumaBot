# ADR 0036 — Escopo de sessão no bot e no storage

**Status:** Aceito (2026-10-07) · Detalha as decisões **D04** ([ADR 0004](0004-uma-sessao-por-processo.md)) e **D14** ([ADR 0014](0014-storage-port-sqlite-postgres.md))

## Contexto

O ADR 0004 diz que multissessão é instanciar `Bot` mais de uma vez, e o ADR 0014 põe o Postgres
como escala multiprocesso. Mas nada do que o bot persiste sabe de sessão: os jobs do scheduler
ficam em `$scheduler`, os overrides de config em `$config` e os dados de cada plugin no namespace
do nome dele. Dois bots no mesmo storage (no mesmo processo ou em processos que dividem um banco)
disparam os mesmos jobs, dividem o KV dos plugins e sobrescrevem a config um do outro. A revisão
do M1 confirmou o disparo duplo com um teste.

No WhatsApp, multiprocesso só pode significar um número diferente por processo: duas conexões do
mesmo número se derrubam ("connection replaced").

Alternativas consideradas: um banco por número e por processo como regra, sem escopo no core
(cada número com seu arquivo SQLite ou schema Postgres; fácil de errar ao compartilhar um banco);
sessão como parâmetro explícito do `StoragePort` (`forNamespace(session, ns)`), mudando o
contrato dos adapters sem ganho sobre a solução no kernel.

## Decisão

- **`createBot({ session })`**, com padrão `'default'`. A sessão identifica o número que este bot
  opera; o nome segue as regras de nome de plugin (kebab-case) para servir de chave estável.
- **Tudo o que o bot persiste fica no escopo da sessão**: namespaces dos plugins, jobs do
  scheduler, overrides de config e o auth state (`storage.authState(session)`). O kernel aplica o
  escopo ao montar os namespaces; o `StoragePort` não muda, porque o adapter já isola strings
  distintas. Um plugin continua sem alcançar dados do kernel nem de outra sessão.
- **Config por sessão**: os overrides (camada "storage" do ADR 0032) valem só para a sessão que
  os gravou.
- **A mesma sessão não roda duas vezes.**
  - No processo: o `createBot` recusa uma sessão que outro bot vivo já usa no mesmo storage.
  - Entre processos: o transport normaliza a desconexão por conexão substituída como
    `DisconnectReason` `'replaced'`; a `ReconnectionPolicy` decide não reconectar e o bot para
    com erro claro, em vez de dois processos se derrubarem em laço.
- Um banco por número continua sendo o deploy recomendado para quem roda um número só; dividir
  um banco entre números passa a ser seguro, não obrigatório.
- Dados compartilhados entre sessões (ex.: uma lista comum a todos os números) ficam fora da v1;
  entram quando um plugin real precisar.

## Consequências

- Dois bots no mesmo storage deixam de interferir; o scheduler não precisa de trava de posse por
  job, porque cada sessão tem um processo só.
- O D14 mantém o argumento: um Postgres compartilhado por vários números, um por processo.
- Os ganchos de reconexão ganham `'replaced'`, que o transport precisa mapear (M2-1).
- Trocar o nome da sessão "esquece" os dados da anterior; a documentação deixa isso explícito.
- Não há dados em produção no formato atual, então não há migração.
