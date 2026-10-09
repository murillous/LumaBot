# ADR 0063 — Prefixo por tipo de chat e por chat, vazio permitido

**Status:** Aceito (2026-10-09) · Detalha **D12** ([ADR 0012](0012-pipeline-de-3-estagios.md))
e **D60** ([ADR 0060](0060-resposta-esperada.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O bot tinha um prefixo só (`BotConfig.prefix`, padrão `!`), e o roteador recusava o prefixo
vazio com `TypeError` (#276). A investigação confirmou dois problemas:

- **Telegram em grupo.** O comando chega como `/start@MeuBot args`. Com `prefix: '/'`, o token
  ficava `start@meubot`, o registro não o achava, e a mensagem ia aos listeners como texto comum.
  O comando era ignorado sem aviso.
- **Chatbot do web e WhatsApp oficial.** Na conversa individual com o bot, como o widget do ERP,
  a pessoa digita `notas`, não `!notas`. Não havia como tirar o prefixo, nem como ter prefixos
  diferentes por chat.

O mesmo padrão não aparece em outro ponto do core: o clique num botão (ADR 0062) já chega com o
nome do comando, sem prefixo, e a espera de resposta (ADR 0060) usa o `match` do roteador.

Alternativas consideradas:

- **Vários prefixos ao mesmo tempo** (`['!', '/']`, a menção ao bot como prefixo no Discord).
  Cada mensagem testaria todos, e o caso que motivou a issue se resolve com o prefixo por tipo
  de chat. Pode entrar depois, de forma aditiva.
- **O transport entrega o comando já interpretado** (`message.command`) quando a plataforma tem
  comando nativo. Exigiria um campo novo na mensagem e um caminho a mais no roteador. Hoje
  nenhum transport o forneceria.
- **API no contexto da mensagem** (`ctx.chat.setPrefix`). Ficaria fora do alcance de rotas e
  jobs, e exigiria um objeto `ctx.chat` novo.
- **Ler o override do storage a cada mensagem, ou só na primeira de cada chat.** A primeira põe
  I/O no caminho quente. A segunda põe um `await` na primeira mensagem e precisa de limite para a
  memória não crescer sem fim.
- **Com prefixo vazio, a espera de resposta vence o comando.** Sairia da regra do ADR 0060, de
  que um comando digitado cancela a espera. Para sair da conversa, a pessoa teria de esperar a
  expiração.

## Decisão

- **Padrão por tipo de chat.** `BotConfig.prefix` aceita um texto, que vale para todo chat, ou
  `{ dm?, group? }`. `group` vale para todo chat que não é `dm` (grupo, canal, thread), pelo
  `chat.isGroup`. Tipo omitido: `'!'`.
- **Prefixo vazio permitido.** A primeira palavra é comparada com os comandos, com as mesmas
  regras de token. A doc avisa que, num grupo, uma mensagem que começa com o nome de um comando
  vira comando.
- **Override por chat no storage.** `ctx.prefixes`, no contexto do plugin:
  - `get(chat)` devolve o prefixo em vigor (o override ou o padrão do tipo);
  - `set(chatId, prefix)` grava o override;
  - `reset(chatId)` o apaga e devolve se havia um.

  O override vale para o bot inteiro, não só para o plugin que o gravou. Ele fica no namespace
  do kernel `$prefixes`, na sessão do bot (ADR 0036). As escritas entram em fila, e o storage é
  gravado antes do mapa em memória. Depois do descarte do contexto, `set` e `reset` rejeitam com
  `ContextExpiredError`.
- **Lido inteiro no boot.** O bot carrega os overrides antes do `setup` dos plugins. O roteador
  consulta só o mapa em memória. Poucos chats têm override, então a memória fica pequena.
- **Validação.** Prefixo que não é texto, ou que começa com espaço em branco, lança `TypeError`:
  na config, no `createBot`; no `set`, na chamada. O texto da mensagem perde os espaços iniciais
  antes do match, então esse prefixo nunca casaria. Prefixo e token continuam comparados sem
  diferenciar caixa.
- **`cmd@usuario` da própria sessão.** Se o token termina com `@` e o `username` da sessão
  (`transport.self.username`, ADR 0057), o roteador tira esse trecho. `cmd@OutroBot` é de outro
  bot e não casa. Sem `username` na sessão, o token fica como veio. O `invokedAs` é o token sem o
  `@`.
- **A espera continua antes do roteador** (ADR 0060). Um comando digitado cancela a espera,
  também com prefixo vazio. A doc avisa que responder `ajuda` a um passo roda o comando `ajuda`.
- O comando `!prefixo`, restrito a `group-admin`, fica no `plugin-utils` (#130), sobre a API
  pública.

## Consequências

- Mudança aditiva: `BotConfig.prefix` aceita também um objeto, `PluginContext.prefixes` é novo e
  os tipos `PrefixConfig` e `Prefixes` saem no `index.ts`. Um bot com `prefix: '!'` se comporta
  como antes.
- O `CommandRouterOptions.prefix`, interno, aceita uma função do chat, e ganha `selfUsername`.
- O boot faz uma leitura a mais no storage, antes do `setup`. Se o storage falha, o boot falha,
  como no scheduler.
- Custo por mensagem: uma consulta a um `Map` e uma comparação de sufixo no token.
- Com prefixo vazio num grupo, conversas comuns podem disparar comandos. Quem configura escolhe,
  e a doc avisa.
