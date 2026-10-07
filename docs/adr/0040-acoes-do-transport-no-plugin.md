# ADR 0040 — Ações e leituras do transport chegam ao plugin pela API pública

**Status:** Aceito (2026-10-07) · Detalha **D16** ([ADR 0016](0016-manifesto-do-plugin.md)) e
**D19** ([ADR 0019](0019-fila-de-saida-anti-ban.md))

## Contexto

O `PluginContext` só sabia enviar mensagem (#224). O contrato `Transport` já tinha `react`, `edit`,
`delete`, `sendPresence`, `getGroupMetadata` e `updateGroupParticipants`, com as capabilities
correspondentes, mas nada disso chegava ao plugin. Faltavam também leituras que os plugins
previstos usam: a lista de comandos (`plugin-help`), o contato da própria sessão (`plugin-ai`), as
capabilities em runtime, a chave da mensagem recebida (para reagir ou apagar) e um evento de
contatos (`plugin-user-names`).

O único caminho era `ctx.unsafe.native`, o que contraria o ADR 0011 (escape hatch é exceção) e o
ADR 0029 (o repo privado só usa API pública).

Alternativas consideradas:

- **Só as ações de mensagem pela fila**, presença e participantes direto no transport. Menos
  mudança na fila, mas presença e banimento em massa fugiriam do anti-ban.
- **Nada pela fila**, tudo direto com prazo. Contraria o ADR 0019: reação e edição também são
  tráfego que o WhatsApp conta.
- **Exportar `messageKey()` em `@zapforge/core`** em vez de pôr a chave na `Message`. O plugin
  teria de lembrar de chamar, e a chave da mensagem citada exigiria a mesma chamada.
- **Superfície nova `ctx.messages`** para reagir, editar e apagar. O nome colide com
  `ctx.plugin.messages` (os textos do plugin, ADR 0025).
- **Cache dos metadados de grupo.** Ninguém mediu a necessidade ainda; fica para quando um plugin
  mostrar o custo.

## Decisão

- **Toda escrita passa pela fila de saída.** A fila ganha `enqueue(chatId, ação, { priority })`,
  que aplica à ação os mesmos intervalos, prioridade, retry, pausa e prazo do envio. A humanização
  continua só no envio. A fila não passa a conhecer mais métodos do transport: quem enfileira
  passa a ação pronta.
- **`ctx.send` reúne as escritas sobre mensagens e chats**: `send`, `react(key, emoji)`,
  `edit(key, text)`, `delete(key)` e `presence(chatId, presence)`, todos com `{ priority }`
  opcional (padrão `'normal'`). A regra para o autor fica simples: o que está em `ctx.send` passa
  pela fila.
- **`ctx.groups`**: `metadata(groupId)` vai direto ao transport, porque leitura não é tráfego que
  o anti-ban limita. `updateParticipants(groupId, ids, action)` é escrita e passa pela fila.
- **Capability conferida antes de enfileirar.** Sem ela, a chamada rejeita na hora com
  `UnsupportedError`, sem ocupar a fila. Quem quer o recurso como opcional consulta
  `ctx.capabilities` (`ReadonlySet<Capability>`) antes.
- **Leituras no contexto**: `ctx.commands.list()` devolve os comandos registrados de todos os
  plugins (`plugin`, `name`, `aliases`, `description`, `role`), sem expor o `run` de ninguém;
  `ctx.self` é o contato da sessão (`null` até a primeira conexão).
- **`message.key`**: toda `Message` traz a sua `MessageKey`, preenchida por `createMessage`
  (inclusive na `quoted`). O adapter não a informa: o kernel a deriva dos campos que já existem.
- **Atalho `react(emoji)`** no contexto de comando e nos listeners de eventos de mensagem, com
  prioridade `'high'` como o `reply`, preso ao mesmo prazo (ADR 0033).
- **Evento `contact.updated`** em `TransportEvents`: `{ id, name?, phone? }`, só os campos
  alterados preenchidos, como o `group.updated`. Não é de um chat: passa pelo `chatFilter` e pelo
  `ignoreSelf` sempre (ADR 0038).
- **Contexto descartado recusa** todas as ações e o `groups.metadata` com `ContextExpiredError`,
  como o `send` já fazia. As leituras síncronas (`self`, `capabilities`, `commands.list`) seguem
  respondendo.
- O kernel não restringe `edit` e `delete` à mensagem do próprio bot: quem sabe o que o canal
  permite é o transport, e apagar mensagem alheia é legítimo para admin de grupo.

## Consequências

- Os plugins do M4/M5 (`help`, `everyone`, `user-names`, `ai`) não precisam do escape hatch.
- Uma presença explícita ocupa o intervalo do chat: o `reply` logo depois dela espera
  `outbound.chatIntervalMs` (1 s por padrão). É o preço de contar presença como tráfego.
- Reação e edição também re-tentam em falha transitória. Uma reação re-tentada depois de uma
  falha que na verdade foi entregue só repete o mesmo emoji, o que é inofensivo.
- `Message` ganha um campo obrigatório. Quem monta `Message` à mão (testes) precisa preenchê-lo;
  quem usa `createMessage` não muda.
- Um `groups.metadata` pendurado não tem prazo próprio: o prazo da execução (comando, listener,
  job, setup) já limita quem espera.
- O kit de testes do M2-3 (`@zapforge/testing`) espelha esta superfície.
