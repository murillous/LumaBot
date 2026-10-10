# ADR 0075 — Vários bots num storage e escopo compartilhado opt-in

**Status:** Aceito (2026-10-09) · Detalha **D04** ([ADR 0004](0004-uma-sessao-por-processo.md)) ·
Substitui o item "dados compartilhados entre sessões ficam fora da v1" do **D36**
([ADR 0036](0036-escopo-de-sessao.md)) · Segue **D72** ([ADR 0072](0072-isolamento-por-tenant.md))
· Parte do kernel multiplataforma ([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

Para servir WhatsApp, Discord, Telegram e web, sobe-se um `Bot` por transport (ADR 0004). Cada um
tem a própria sessão, e tudo o que ele persiste fica nela (ADR 0036). Um plugin não tinha como
dividir dados entre plataformas (um rank, as personas, a memória de uma assistente), mesmo
querendo (#279).

A investigação:

- **Vários bots no mesmo processo e no mesmo storage já funcionam.** O `createBot` aplica o escopo
  da sessão sobre a instância recebida, recusa a mesma sessão duas vezes e só fecha o storage
  quando o último bot para (`session.test.ts` cobre jobs, KV e config). Faltava o escopo comum.
- **Concorrência.** O kernel não tem transação: ler, somar e gravar a mesma chave já corre em dois
  chats do mesmo bot, que a fila de entrada roda em paralelo. Dois bots na mesma chave comum são o
  mesmo caso, não um novo. O SQLite serializa as escritas da instância; no Postgres (#119), o
  mesmo vale entre processos.
- **IDs colidem entre transports.** O `chat.id` e o `sender.id` são opacos e únicos só dentro do
  transport (ADR 0058): o `42` do Telegram e o snowflake do Discord podem coincidir. O plugin não
  sabia em que transport estava. Na mesma plataforma, dois números do WhatsApp têm o mesmo
  espaço de IDs, e a mesma pessoa deve ser a mesma chave: a sessão não serve de prefixo.
- **Tenant.** Um escopo comum que ignorasse o tenant (ADR 0072) vazaria entre clientes no
  primeiro plugin que gravasse nele dentro de um handler do web.
- **HTTP e dashboard.** O servidor do D20 ainda não existe (#120). O ADR 0021 já deixa o
  dashboard central de vários números fora do escopo.

Alternativas consideradas:

- **Escopo nomeado entre plugins** (`ctx.storage.shared('rank')`): plugins diferentes dividiriam
  dados pelo nome. Abre o dado de um plugin para outro, papel que já é dos services (ADR 0018).
- **Opção no `createBot`** marcando os plugins compartilhados: tudo ou nada, sem o plugin poder
  ter dado local e comum ao mesmo tempo.
- **`shared` que ignora o tenant**: mais simples, mas reabre o vazamento que o ADR 0072 fechou.
- **O kernel prefixar as chaves do `shared` com o transport**: esconde a colisão, mas quebra o
  dado legitimamente comum (uma lista de palavras, a config de uma persona).
- **Só documentar a colisão**: sem fonte confiável no contexto, cada plugin inventaria a sua.
- **Hub de processo** (`createHub({ bots, http, storage })`) ou **multi-transport num `Bot`**:
  o primeiro é abstração antes de haver HTTP para compor; o segundo foi descartado na issue
  (capabilities por mensagem, filas e reconexão por transport, IDs prefixados em todo lugar).

## Decisão

- **Um transport por `Bot`, vários `Bot`s por processo com a mesma instância de storage**, uma
  sessão cada. Não há multi-transport num bot nem hub.
- **`ctx.storage.shared`**: o mesmo `kv` e as mesmas `collection` do `ctx.storage`, no namespace
  `$shared:<plugin>`, montado sobre o storage do `createBot` e não sobre o da sessão. Só o próprio
  plugin o alcança, em qualquer sessão. Começa com `$`, então nenhum namespace de plugin coincide
  com ele, e os componentes do kernel não têm `:` no nome.
- **O `shared` segue o tenant corrente** como o `ctx.storage`: `$shared:<plugin>@<tenant>` no chat
  de um tenant, com `ctx.storage.shared.forTenant(id)` para escolher um à mão.
- **`ctx.transportName`**: o `Transport.name` do bot, somente leitura. A doc manda compor com ele a
  chave do `shared` que vier de um ID. O kernel não reescreve chaves.
- **Sem garantia nova de concorrência.** A doc avisa que ler e gravar a mesma chave em dois bots
  pode perder uma escrita e recomenda um documento por pessoa quando isso importa.
- **HTTP (#120): um servidor por processo**, passado aos bots como o storage (a mesma instância),
  com as rotas sob a sessão. A forma e os caminhos ficam para o ADR do #120. O dashboard central
  de vários números segue fora (ADR 0021).

## Consequências

- Mudança aditiva: `shared` e `transportName` são campos novos do contexto, e o `StoragePort` e
  os adapters não mudam. `ctx.storage` passa a ser `PluginContextStorage` (`TenantStorage` com
  `shared`).
- O dado comum não tem dono por sessão: apagar uma sessão não apaga o `shared`, e trocar o nome
  do plugin "esquece" os dois.
- A mesma pessoa em plataformas diferentes continua sendo chaves diferentes. Ligar contas é do
  plugin.
- O teste de aceite "dois bots, um storage, sem leitura cruzada fora do escopo compartilhado"
  fica em `bot/shared-storage.test.ts`.
- O #120 herda a direção do servidor único por processo e precisa de um ADR que a detalhe.
