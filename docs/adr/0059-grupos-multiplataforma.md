# ADR 0059 — Grupos multiplataforma: admin, participantes, ações e eventos

**Status:** Aceito (2026-10-09) · Detalha **D24** ([ADR 0024](0024-papeis-no-core.md)) e
**D46** ([ADR 0046](0046-ids-de-contato-e-metadata-de-grupo.md)) · Substitui em parte **D10**
([ADR 0010](0010-capabilities-do-transporte.md)) e **D40**
([ADR 0040](0040-acoes-do-transport-no-plugin.md)) na capability `groups.admin`, e **D38**
([ADR 0038](0038-filtro-de-eventos-no-kernel.md)) no `groupId` dos eventos · Parte do kernel
multiplataforma ([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O papel `group-admin` (D24) só funcionava com a lista completa de participantes do WhatsApp
(#270): o `Bot` chamava `getGroupMetadata(chatId)` e procurava o remetente em `participants`.
Fora do WhatsApp:

- **Telegram** não lista membros. Só dá para pedir os admins (`getChatAdministrators`) ou um
  membro (`getChatMember`).
- **Discord** decide admin por permissão de servidor (`ADMINISTRATOR`, `MANAGE_GUILD`...) somada
  aos overwrites do canal. Listar membros exige a intent privilegiada `GUILD_MEMBERS` e custa caro
  em servidor grande.

Sem a lista, o papel recusava todo mundo calado, ou não tinha implementação honesta.

O resto do contrato de grupo tinha o mesmo formato:

- `GroupMetadata.subject` é o termo do WhatsApp. O `Chat` já tem `title` (ADR 0058).
- As quatro ações de participante dividiam a capability `groups.admin`. Bot do Telegram ou do
  Discord não adiciona ninguém (só convite), mas remove e promove.
- Os eventos `group.*` traziam só `groupId`. O `chatFilter` não via o `parentId` do canal, e
  entrar num servidor do Discord não é entrar num chat.

Alternativas consideradas:

- **O adapter fornece a porta `isGroupAdmin` inteira**, no lugar do `Bot`. Todo transport teria de
  reimplementar o prazo e o casamento por telefone do WhatsApp (ADR 0046).
- **`participants` parcial e documentado** (no Telegram, só os admins). É aditivo, mas um plugin
  que menciona todos agiria sobre uma lista incompleta sem saber.
- **Manter `groups.admin`** e lançar `UnsupportedError` só na ação que falta. O plugin declararia a
  capability em `requires`, passaria no boot e quebraria em runtime.
- **Nível de admin** (dono, admin, moderador). O papel `group-admin` só precisa de um sim ou não, e
  `isSuperAdmin` já cobre o dono.

## Decisão

- O `Transport` ganha o método **opcional** `isChatAdmin(chat: Chat, contact: Contact):
  Promise<boolean>`. Cada transport responde do jeito da plataforma, com o chat inteiro, porque no
  Discord o admin é do servidor (`parentId`).
- O `Bot` monta a porta `isGroupAdmin` do roteador assim:
  1. com `isChatAdmin`, usa só ele;
  2. sem ele, com a capability `groups`, procura o contato nos `participants` do
     `getGroupMetadata`, como antes (ADR 0046);
  3. sem nenhum dos dois, não há porta, e `group-admin` recusa quem não é owner.

  Nos dois primeiros casos vale o prazo do comando (`GroupAdminTimeoutError`). A porta passa a
  receber o `Chat` inteiro, e não só o `chatId`.
- `GroupMetadata.participants` fica **opcional**: ausente quando a plataforma não lista membros, e
  nunca pela metade. Sem a lista e sem `isChatAdmin`, o `group-admin` recusa (fail-closed).
- `GroupMetadata.subject` vira **`title`**, sem alias, como o `Chat.title`.
- A capability `groups.admin` dá lugar a três: **`groups.add`**, **`groups.remove`** e
  **`groups.promote`**. A última vale para `promote` e `demote`, que andam juntas em toda
  plataforma. `ctx.groups.updateParticipants` cobra a capability da ação pedida. O adapter usa
  `groupActionCapability(action)`, de `@zapforge/core/adapter`. `remove` tira a pessoa sem impedir
  que volte. No Telegram, o transport bane e desbane em seguida.
- Os eventos `group.joined`, `group.left`, `group.participants` e `group.updated` trocam
  `groupId` por **`chat: Chat`**, como `reaction` e `message.deleted`. Em `group.updated`,
  `subject` vira `title`. `announce` e `restrict` continuam opcionais e só vêm onde a plataforma
  tem a configuração.
- Onde o bot entra num espaço e não num chat (servidor do Discord), `group.joined` e `group.left`
  trazem o espaço como `chat`. O `id` é o mesmo que os canais dele trazem em `parentId`.
- O `chatFilter` casa `group.participants` e `group.updated` pelo `chat.id` ou pelo
  `chat.parentId` (ADR 0058). `group.joined` e `group.left` continuam passando sempre.

## Consequências

- Quebra de API antes do 1.0 (D27), registrada nos changesets:
  - transports trocam `groupId` por `chat` nos eventos, `subject` por `title` e declaram as três
    capabilities;
  - plugins que citam `groups.admin` em `requires` passam a citar a da ação que usam;
  - quem lê `participants` trata a ausência.
- No WhatsApp nada muda no comportamento. O Baileys declara as três capabilities, não implementa
  `isChatAdmin` e segue no caminho do `getGroupMetadata` com cache.
- Custo por mensagem: nenhum. A porta só roda em comando `group-admin` de quem não é owner.
- O kit de testes (`FakeTransport`) cobra a capability da ação. Perfis de plataforma e
  `isChatAdmin` no kit ficam com o #285.
- O `plugin-everyone` (#128) não pode contar com `participants`. Onde a lista falta, ele depende
  de uma menção a todos nativa, assunto das menções portáteis (#273).
- `ctx.groups` não ganha consulta de admin agora. Se um plugin precisar, ela entra depois como
  método novo, sem quebrar a API.
