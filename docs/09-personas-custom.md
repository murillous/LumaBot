# 🎭 Personas Customizadas via Chat

A Luma tem personas **predefinidas** (vivem em código, em `src/config/lumaConfig.js`)
e personas **customizadas**, criadas em tempo de execução por qualquer membro do chat
a partir de uma descrição livre. As custom são persistidas **por chat** (por `JID`),
ativam na hora e podem ser deletadas. As predefinidas são imutáveis (de fábrica).

---

## Como o usuário usa

Dois caminhos chegam ao mesmo lugar:

1. **Comando explícito** — `!persona criar <descrição livre>`
   Ex.: `!persona criar uma pirata mal-humorada que odeia turistas`.
2. **Linguagem natural (function calling)** — a pessoa pede em conversa
   ("vira um vampiro elegante", "queria que você fosse uma chef italiana") e o
   modelo dispara a tool `create_persona` com a descrição. Ver
   [`docs/02-nucleo-ia.md`](02-nucleo-ia.md) (tool calling).

Em ambos os casos a Luma confirma na própria voz ("agora eu sou \<name\>") e passa
a responder como a nova persona naquele chat.

### Menu e deleção

- `!persona` (sem args) lista predefinidas **+** custom do chat, numeradas `p1..pN`.
  Predefinida padrão marcada com `⭐ (Padrão)`; custom marcadas como deletáveis (`🗑️`);
  a persona ativa fica destacada no topo.
- `!persona deletar pN` remove a custom de número `pN`. Tentar deletar uma
  predefinida é recusado ("essa é de fábrica, não dá pra apagar"). Se a persona
  deletada era a **ativa** do chat, o chat volta para a padrão (`pensadora`).

Todas as mensagens/labels ficam em `src/config/constants.js` (`MENUS.MSGS`,
`MENUS.PERSONALITY`) — nada hardcoded no plugin.

---

## Fluxo interno

```
!persona criar <desc>            create_persona (tool)
        │                                │
   LumaPlugin                      ToolDispatcher
   #handleCreatePersona           handleCreatePersona
        └──────────────┬─────────────────┘
                       ▼
              PersonaGenerator.generate(desc)   → shape validado
                       ▼
              slugify(name, slugsExistentes)    → key única (sem prefixo)
                       ▼
       DatabaseService.createCustomPersona(jid, {...persona, key})
                       ▼
       PersonalityManager.setPersonality(jid, 'custom:'+slug)  → ativa
                       ▼
       DatabaseService.incrementMetric('personas_created')
```

### `PersonaGenerator` (`src/core/services/PersonaGenerator.js`)

Recebe `aiService` por injeção de dependência. `generate(description)`:

- Monta prompt PT-BR pedindo JSON `{ name, description, context, style, traits[] }`.
- Extrai o JSON tolerando cercas de código / texto extra.
- Valida e **trunca quando seguro**: `name ≤ 40`, `context ≤ 600`, `style ≤ 300`,
  cada trait `≤ 200`, `traits` entre 3 e 8. `traits < 3` é rejeitado.
- Anexa **pelo sistema** (não pelo modelo) o trait final com a regra de formato do
  WhatsApp (`≤ 200 chars/bloco`, `[PARTE]`) já usada pelas personas predefinidas.
- JSON malformado dispara **1 retry**; se persistir, lança erro tratável — **nada
  é gravado** e a persona atual do chat é mantida (FR-9).

`slugify(name, existingKeys)` deriva uma key kebab-case sem acentos (fallback
`persona`), garantindo unicidade por sufixo (`-2`, `-3`, …).

### `PersonalityManager` (`src/managers/PersonalityManager.js`)

- `getPersonaConfig(jid)` resolve na ordem **custom do chat → predefinida →
  `DEFAULT_PERSONALITY`** e devolve o shape `{ name, description, context, style,
  traits[] }` (o `PromptBuilder` não muda).
- `setPersonality(jid, key)` aceita chaves custom, validando contra predefinidas
  **ou** custom do chat.
- `getList(jid)` mescla predefinidas + custom do chat, marcando cada item com
  `isCustom`.
- `deletePersona(jid, key)` só remove se a key for custom do chat; recusa
  predefinida; se removeu a ativa, faz fallback para a padrão e incrementa
  `personas_deleted`.

> **Convenção de key:** a key custom é gravada/lida com prefixo interno `custom:`
> em `chat_settings.personality` e em `getList`, para nunca colidir com
> predefinidas. O slug "puro" (sem prefixo) é o que vai para
> `createCustomPersona` / `getCustomPersona` / `deleteCustomPersona`.

---

## Persistência e limites

- Tabela `custom_personas` no `luma_private.sqlite` (contém `chat_jid`), com
  `UNIQUE (chat_jid, key)` e índice `idx_custom_personas_chat`. Esquema completo
  em [`docs/04-banco-dados.md`](04-banco-dados.md).
- **Teto de 10 personas custom por chat.** No limite, criar é recusado com mensagem
  pedindo para deletar antes — nada é gravado.
- **Telemetria sem vazamento:** apenas os contadores agregados `personas_created`
  e `personas_deleted` vão para o banco **público** (`luma_metrics.sqlite`). Nem
  JID nem conteúdo da persona saem do banco privado.

---

## Por quê desse jeito

A decisão de persistir personas **por chat** no `luma_private.sqlite` (em vez de
globais ou em arquivo de config) está registrada no ADR
[`docs/adr/0001-personas-custom-por-chat.md`](adr/0001-personas-custom-por-chat.md).
