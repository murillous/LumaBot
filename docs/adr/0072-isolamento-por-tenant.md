# ADR 0072 — Isolamento automático por tenant

**Status:** Aceito (2026-10-09) · Detalha **D36** ([ADR 0036](0036-escopo-de-sessao.md)) e
**D15** ([ADR 0015](0015-storage-kv-e-colecoes.md)) · Segue **D04**
([ADR 0004](0004-uma-sessao-por-processo.md)) e **D57**
([ADR 0057](0057-contact-multiplataforma.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O chatbot web vai atender vários clientes do dono (empresas no ERP, escolas na gestão escolar)
com um mesmo bot, e o cliente vem nos claims do JWT (#278). O único isolamento automático era a
sessão (ADR 0036): dentro dela, todos os clientes dividiam o namespace `<sessão>:<plugin>`. Um
plugin que esquecesse de filtrar por cliente vazaria os dados de uma escola para outra.

A investigação:

- **O handler não recebe `storage`.** Comando, listener e passo usam o `ctx.storage` do `setup`
  por closure. Um `storage` com escopo só no contexto do handler deixaria esse caminho aberto, e
  o isolamento voltaria a depender do plugin.
- **Services.** O service do plugin A chamado pelo handler de B grava no storage de A, que não
  sabe de que cliente é a mensagem.
- **O resto do core é chaveado por ID.** Prefixos por chat (`$prefixes`, ADR 0063), esperas de
  resposta (ADR 0060), ações (ADR 0062) e rate limit usam `chat.id` e `sender.id`. Não vazam se
  dois tenants nunca dividirem um ID. Os overrides de `$config` são por plugin, a config do
  operador, e ficam compartilhados de propósito.
- **Scheduler.** O job dispara longe da mensagem que o agendou e perderia o cliente.
- **Namespace.** `<sessão>:<plugin>:<tenant>` colide com a sessão `default`, que fica sem prefixo:
  `escola:t1` seria tanto o tenant `t1` do plugin `escola` quanto o plugin `t1` da sessão
  `escola`.

Alternativas consideradas:

- **Campo `storage` novo no contexto do handler**, com escopo, e o do `setup` sem. Deixa a
  closure e o service sem escopo: o plugin teria de lembrar qual dos dois usar.
- **Tenant como sessão lógica** (uma sessão por tenant no mesmo `Bot`). O scheduler, a config e
  os prefixos ficariam por tenant sem necessidade, e o número de tenants não é conhecido no boot.
- **Só expor o `tenantId` e cada plugin filtrar.** Descartado na issue: é o vazamento que se quer
  evitar.
- **`tenantId` na `Message`** ou no **`Contact`**. Na `Message`, a reação, o voto, o clique e a
  mensagem apagada precisariam de campo próprio. No `Contact`, ficaria ausente nos contatos de
  `mentions`, e a mesma pessoa mudaria de tenant no meio da conversa.
- **Recusar o `ctx.storage` sem tenant** num transport com tenants (capability nova). Seria mais
  seguro, mas exigiria API para o dado global do plugin, e não vale para WhatsApp, Discord e
  Telegram.
- **`forTenant` só fora de handler.** Um plugin de administração teria de agendar job para ler
  outro cliente. A proteção é contra esquecer, não contra má-fé: plugins são código de confiança
  no mesmo processo (ADR 0005).

## Decisão

- **`Chat.tenantId?: string`**, opcional. O transport o preenche só com o que **verificou** (o
  claim configurado do JWT no web), em todo evento do chat. Uma conversa é de um tenant só.
- **Com tenant, o transport compõe o tenant no `chat.id` e no `id` dos contatos**: dois tenants
  nunca dividem um ID. Assim prefixos, esperas, ações e rate limit ficam isolados sem mudança.
- **Escopo pelo contexto assíncrono.** Cada bot tem um `TenantScope` (um `AsyncLocalStorage`; nada
  global, ADR 0004). A fila de entrada roda a mensagem, a edição e o clique no escopo do
  `chat.tenantId`, e o `forward` faz o mesmo com os eventos diretos. O **mesmo** `ctx.storage`
  resolve o namespace do tenant corrente a cada operação: no handler, na closure do `setup`, no
  service de outro plugin e no timer iniciado no handler.
- **Namespace `<plugin>@<tenant>`** (na sessão `vendas`, `vendas:notas@escola-a`). O tenant fica no
  fim porque pode ter qualquer caractere. `pluginStorage` recusa `@` no nome do plugin, como já
  recusa `:` e `$`.
- **Sem tenant no escopo** (`setup`, timer iniciado nele, job sem tenant, transport sem tenant),
  vale o escopo da sessão, como antes. Ele é compartilhado entre os tenants: é o dado do plugin
  inteiro.
- **`ctx.storage.forTenant(id)`** escolhe um tenant à mão, de qualquer lugar, inclusive do handler
  de outro tenant. ID vazio lança `TypeError`. Quem pode usar o comando de administração é
  decidido pelo `role`, não por um papel novo de storage.
- **O job guarda o tenant de quem agendou** (`tenant` no documento de `$scheduler`), e o handler
  roda no escopo dele. O job sem tenant sai de qualquer escopo, para não herdar o de quem acordou
  o loop.

## Consequências

- Mudança aditiva: `tenantId` é opcional, e sem ele nada muda. `ctx.storage` passa a ser
  `TenantStorage` (`PluginStorage` com `forTenant`). O `StoragePort` e os adapters não mudam.
- Um plugin com `@` no nome passa a ser recusado pelo storage. O nome de plugin já é kebab-case
  (M1-8), então nenhum plugin válido muda.
- Custo: a mensagem sem tenant não entra no `AsyncLocalStorage` (só uma leitura de campo). Com
  tenant, há um `run` por mensagem ou evento e uma leitura do escopo por operação de storage.
- Os storages por tenant ficam em cache no plugin. O número de tenants é o de clientes do dono,
  não o de usuários.
- Trocar o ID de um tenant "esquece" os dados do anterior, como trocar a sessão.
- Estado em memória de um service (um `Map` no plugin) não ganha escopo e continua sendo
  responsabilidade do plugin. A doc recomenda guardá-lo no `ctx.storage`.
- O `transport-web` (#287) lê o claim configurado e preenche `chat.tenantId`. O kit de testes já
  aceita o campo em `receive({ chat })`.
