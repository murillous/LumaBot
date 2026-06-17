# PRD: Personas Customizadas via Chat

| Campo | Valor |
|-------|-------|
| **Status** | Proposto |
| **Autor** | Levantado via `/grill-me`; reformatado via `/prd` |
| **Data** | 2026-06-17 |
| **Módulo** | Núcleo de IA / Sistema de Personalidades |
| **Arquivos-chave** | `lumaConfig.js`, `PersonalityManager.js`, `Database.js`, `LumaPlugin.js`, `ToolDispatcher.js`, `CommandRouter.js`, `constants.js` |

---

## Introduction

Hoje as personalidades da Luma são **fixas em código** (`src/config/lumaConfig.js → PERSONALITIES`):
`pensadora`, `agressiva`, `amigavel`, `intelectual`, `literal`. Cada uma tem o shape
`{ name, description, context, style, traits[] }`. O usuário só **seleciona** entre elas
via `!persona` (menu numerado `p1`, `p2`...), e a escolha ativa é gravada por JID em
`chat_settings (jid PK, personality TEXT)`.

Não há como um usuário **criar** a própria persona em runtime — toda persona nova exige
editar código e fazer deploy.

Esta feature permite que qualquer usuário **crie uma persona via chat**, descrevendo a
vibe em linguagem natural. A IA estrutura a descrição no shape de persona, persiste por
chat e a ativa imediatamente. Personas criadas (custom) são **deletáveis**; as
predefinidas em código são **imutáveis** e nunca somem.

## Goals

- Permitir criação de persona por descrição livre, com a IA gerando os campos estruturados.
- Oferecer dois gatilhos: comando `!persona criar <descrição>` **e** tool `create_persona` (linguagem natural).
- Persistir personas por chat (grupo **ou** PV), chaveadas pelo JID do chat.
- Ativar automaticamente a persona recém-criada (zero passos extras).
- Listar personas custom junto das predefinidas no menu `!persona`, marcando as deletáveis.
- Permitir deleção de personas custom via `!persona deletar pN`.
- Conter abuso: máx **10 personas custom por chat** e campos limitados em tamanho.
- Não quebrar o fluxo existente: seleção de predefinidas e `PromptBuilder` seguem idênticos.

## User Stories

### US-001: Criar persona por comando explícito
**Description:** Como membro de um grupo, quero digitar `!persona criar um vovô gamer ranzinza que xinga em inglês` e ter a Luma virar esse personagem, pra personalizar o bot sem deploy.

**Acceptance Criteria:**
- [ ] `!persona criar <descrição>` aciona a geração; a descrição é tudo após `criar`.
- [ ] Descrição vazia → mensagem de ajuda na voz da Luma (nada é gravado).
- [ ] Persona gerada é persistida no chat e ativada na hora.
- [ ] Confirmação na voz da Luma ("agora eu sou \<name>").
- [ ] Testes Vitest do roteamento do subcomando `criar` passando.

### US-002: Criar persona por linguagem natural (function calling)
**Description:** Como usuário, quero pedir em linguagem natural ("luma, vira uma persona de coach motivacional") e a Luma criar a persona sozinha, mantendo a imersão.

**Acceptance Criteria:**
- [ ] Tool `create_persona` declarada em `lumaConfig.TOOLS.functionDeclarations` com parâmetro `description` (STRING, required).
- [ ] `ToolDispatcher.handleCreatePersona` executa o mesmo caminho do `!persona criar`.
- [ ] Persona criada é persistida e ativada igual ao comando.
- [ ] Teste Vitest de `handleCreatePersona` chamando o gerador e ativando.

### US-003: Ver personas custom no menu unificado
**Description:** Como membro, quero ver minhas personas custom no menu `!persona` junto das predefinidas, marcadas como deletáveis.

**Acceptance Criteria:**
- [ ] `!persona` lista predefinidas **+** custom do chat atual, numeradas `p1..pN`.
- [ ] Predefinidas marcadas como `⭐ (Padrão)` quando aplicável.
- [ ] Custom marcadas como deletáveis (ex: `🗑️`).
- [ ] Persona ativa destacada como hoje.
- [ ] Teste Vitest do menu unificado.

### US-004: Deletar persona custom
**Description:** Como membro, quero deletar uma persona que não uso mais com `!persona deletar p7`.

**Acceptance Criteria:**
- [ ] `!persona deletar pN` remove **apenas** se `pN` for custom.
- [ ] Predefinida recusa ("essa é de fábrica, não dá pra apagar").
- [ ] Se a persona deletada era a **ativa** do chat → volta para `DEFAULT_PERSONALITY` (`pensadora`), com aviso.
- [ ] `pN` fora do range → "opção inválida" (igual hoje).
- [ ] Teste Vitest de `deletePersona` incluindo o fallback da ativa.

### US-005: Mensagem clara ao bater o teto
**Description:** Como usuário, ao bater o teto de 10 personas, quero uma mensagem clara pedindo pra deletar alguma antes de criar nova.

**Acceptance Criteria:**
- [ ] Ao tentar criar com 10 personas custom no chat → recusa com mensagem clara na voz da Luma.
- [ ] Nada é gravado e a persona atual é mantida.
- [ ] Teste Vitest do teto de 10/chat.

## Functional Requirements

- **FR-1 — Criação por comando.** `!persona criar <descrição>` aciona a geração; a descrição é tudo após `criar`. Descrição vazia → mensagem de ajuda na voz da Luma.
- **FR-2 — Criação por function calling.** Nova tool `create_persona` em `lumaConfig.TOOLS`, parâmetro `description` (STRING, required). A Luma a chama quando o usuário pede pra ela "virar/criar uma persona X". `ToolDispatcher.handleCreatePersona` executa o mesmo caminho do FR-1.
- **FR-3 — Geração estruturada pela IA.** Um gerador dedicado monta um prompt que instrui o modelo a devolver **JSON** no shape:
  ```json
  {
    "name": "string curta (ex: 'Vovô Gamer')",
    "description": "string curta com 1 emoji (ex: '🎮 Ranzinza e saudosista')",
    "context": "string ≤ 600 chars",
    "style": "string ≤ 300 chars",
    "traits": ["string", "..."]
  }
  ```
  `traits` tem 3 a 8 itens, cada um ≤ 200 chars. O JSON é parseado e validado (ver FR-7). O último trait **sempre** recebe a regra de formato WhatsApp já usada pelas personas atuais (≤ 200 chars/bloco, `[PARTE]`), anexada pelo sistema — não depende do modelo.
- **FR-4 — Persistência por chat.** A persona é gravada em `custom_personas` (ver Technical Considerations), associada ao `chat_jid`. A chave (`key`) é um slug derivado do `name`, único por chat e **sem colidir** com as chaves predefinidas (prefixo `custom:` no armazenamento interno).
- **FR-5 — Ativação automática.** Após gravar, o chat passa a usar a persona nova: `setPersonality(chatJid, key)`.
- **FR-6 — Listagem unificada.** `!persona` lista predefinidas **+** custom do chat atual, numeradas `p1..pN`. Predefinidas marcadas como `⭐ (Padrão)` quando aplicável; custom marcadas como deletáveis (ex: `🗑️`). A persona ativa é destacada como hoje.
- **FR-7 — Validação e limites.**
  - Máx **10** personas custom por `chat_jid`. No teto → recusa com mensagem clara.
  - `name` ≤ 40 chars; `context` ≤ 600; `style` ≤ 300; `traits` entre 3 e 8, cada ≤ 200.
  - Campos faltando/excedendo → trunca quando seguro, ou rejeita com mensagem na voz da Luma.
  - Colisão de nome no mesmo chat → sufixo numérico no slug (`vovo-gamer-2`).
- **FR-8 — Deleção.** `!persona deletar pN` remove **apenas** se `pN` for custom. Se for predefinida → recusa ("essa é de fábrica, não dá pra apagar"). Se a persona deletada era a **ativa** do chat, o chat volta para `DEFAULT_PERSONALITY` (`pensadora`).
- **FR-9 — Falha de geração.** Se a IA falhar (erro de API, JSON inválido após retry, recusa) → **log + fallback explícito** (CLAUDE.md): mensagem de erro na persona da Luma, nada é gravado, chat mantém a persona atual.

## Non-Goals (Out of Scope)

- **Edição** de persona existente → fluxo é deletar e recriar. *(Por quê: menor solução que resolve, regra do CLAUDE.md.)*
- **Dashboard:** o painel web continua gerenciando só a config global/predefinida. Personas custom vivem no `luma_private.sqlite` (contêm JID) e não são expostas no painel. *(Por quê: evita vazar JID no painel e inchar escopo.)*
- **Compartilhamento** de persona entre chats (cada chat tem as suas).
- **Gating por admin:** qualquer membro cria/deleta. *(Por quê: decisão do dono; mitigada pelos limites do FR-7.)*
- **Etapa de confirmação** antes de salvar: a persona é gravada e ativada direto. *(Por quê: baixo atrito, natural no WhatsApp.)*

## Design Considerations

- **Voz da Luma em tudo.** Confirmações, recusas e erros saem na persona ativa da Luma — não em texto de sistema seco.
- **Menu reaproveita o layout atual** de `!persona` (numerado `p1..pN`, ativa destacada). Apenas acrescenta marcadores de origem: `⭐ (Padrão)` para predefinidas e `🗑️` para custom deletáveis.
- **Subcomandos descobríveis.** `!persona` sem args mostra o menu (inclui dica de `criar`/`deletar`); `!persona criar <desc>` e `!persona deletar pN` são as ações.

## Technical Considerations

### Schema (novo — `data/luma_private.sqlite`)
```sql
CREATE TABLE custom_personas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid    TEXT NOT NULL,
  key         TEXT NOT NULL,            -- slug único por chat (sem prefixo)
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  context     TEXT NOT NULL,
  style       TEXT NOT NULL,
  traits_json TEXT NOT NULL,            -- JSON array de strings
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chat_jid, key)
);
CREATE INDEX idx_custom_personas_chat ON custom_personas(chat_jid);
```
Persistência nova usa o `DatabaseService` estático (`src/services/Database.js`), conforme
CLAUDE.md — não o `StoragePort`.

### `DatabaseService` (novos métodos)
- `createCustomPersona(chatJid, persona)` — INSERT, respeita `UNIQUE`.
- `getCustomPersonas(chatJid)` — lista (para o menu e o merge).
- `getCustomPersona(chatJid, key)` — lookup individual.
- `deleteCustomPersona(chatJid, key)` — DELETE, retorna se removeu.
- `countCustomPersonas(chatJid)` — para o limite do FR-7.

### `PersonalityManager` (alterações)
- `getPersonaConfig(jid)` — resolve na ordem: custom do chat → predefinida → default. Continua devolvendo o shape `{ name, description, context, style, traits[] }`, então `PromptBuilder` **não muda**.
- `getList(jid)` — passa a receber o JID e mesclar predefinidas + custom do chat, marcando cada item com origem (`isCustom`) para o menu saber o que é deletável.
- `setPersonality(jid, key)` — aceitar chaves custom (validar contra predefinidas **ou** custom do chat).
- Novo: `deletePersona(jid, key)` encapsulando o FR-8 (incluindo o fallback da ativa).

### Gerador de persona (novo — `core/services`)
`PersonaGenerator` recebe `aiService` por injeção (DI, igual ao resto). Responsável por:
montar o prompt de geração, chamar `AIPort`, parsear/validar o JSON, aplicar limites e
o trait de formato. Lógica pura de parsing/validação testável sem rede.

### Roteamento de comando
`!persona` hoje é match exato em `CommandRouter`/`constants.js`. Passa a aceitar
subcomandos: `criar <desc>` e `deletar pN`. O parsing do subcomando fica no `LumaPlugin`
(`onCommand` do `COMMANDS.PERSONA`), sem inflar o `CommandRouter`.

### Tool de function calling
Nova entrada em `lumaConfig.TOOLS.functionDeclarations` (`create_persona`) e handler
`handleCreatePersona` no `ToolDispatcher`, reaproveitando `PersonaGenerator`.

### Decisões (resolvidas no levantamento)

| # | Decisão | Escolha | Por quê |
|---|---------|---------|---------|
| 1 | Escopo de visibilidade | **Por chat** (grupo ou PV), chave = JID do chat | Casa com o modelo atual (`chat_settings` já é por JID); isola contextos |
| 2 | Mecanismo de criação | **IA gera** a partir de descrição livre; salva direto (sem confirmação) | Baixo atrito, natural no WhatsApp, casa com a natureza do bot |
| 3 | Gatilho | **Ambos**: comando `!persona criar` + tool `create_persona` | Comando = determinístico/descobrível; tool = imersivo |
| 4 | Permissão | **Qualquer membro** cria e deleta | Decisão do dono; mitigada pelos limites (#6) |
| 5 | Ativação pós-criação | **Ativa na hora** | Intuitivo: criou, quer usar |
| 6 | Limites | **Máx 10/chat**; campos limitados | Conter spam e prompt inchado, já que criação é livre |
| 7 | Deleção | `!persona deletar pN`; só custom; predefinida recusa; deletar a ativa → `DEFAULT_PERSONALITY` | Reversível e seguro; nunca quebra o chat |
| 8 | Edição | **Fora do MVP** | Menor solução que resolve (CLAUDE.md) |
| 9 | Dashboard | **Fora do MVP** | Evita vazar JID no painel e inchar escopo |

### Fluxos

**Criação (comando)**
```
!persona criar <desc>
  └─ LumaPlugin.onCommand(PERSONA) detecta subcomando "criar"
       └─ countCustomPersonas(jid) < 10 ?  (não → recusa)
            └─ PersonaGenerator.generate(desc)  → {name, desc, context, style, traits}
                 ├─ falha → log + erro na voz da Luma (nada gravado)
                 └─ ok → slug único → createCustomPersona(jid, persona)
                            └─ setPersonality(jid, key)  → confirma "agora eu sou <name>"
```

**Criação (function calling)**
```
"luma, vira um coach motivacional"
  └─ Gemini chama create_persona({ description })
       └─ ToolDispatcher.handleCreatePersona → mesmo caminho acima
```

**Deleção**
```
!persona deletar p7
  └─ getList(jid) → resolve p7
       ├─ predefinida → recusa
       └─ custom → deleteCustomPersona(jid, key)
                     └─ era a ativa? → setPersonality(jid, DEFAULT_PERSONALITY)
```

### Edge Cases
- Descrição vazia em `!persona criar` → ajuda na voz da Luma.
- IA retorna JSON malformado → 1 retry; se persistir, FR-9 (fallback).
- IA retorna conteúdo que estoura limites → trunca campos textuais; se `traits` < 3, rejeita.
- Nome colide com persona predefinida → slug recebe prefixo interno `custom:`, nunca sobrescreve a de fábrica.
- `pN` fora do range no deletar/selecionar → "opção inválida" (igual hoje).
- Deletar persona ativa → fallback pra `pensadora`, com aviso.
- Chat no teto de 10 → recusa pedindo pra deletar antes.

### Telemetria
Reaproveitar `DatabaseService.incrementMetric` (banco público, sem JID):
`personas_created`, `personas_deleted`. (Sem conteúdo nem JID — respeita §"Segurança" do doc 04.)

### Riscos
| Risco | Mitigação |
|-------|-----------|
| Spam de criação (qualquer membro) | Teto de 10/chat + métricas |
| Prompt inchado degradando IA | Limites de tamanho por campo (FR-7) |
| JSON instável da IA | Validação + 1 retry + fallback (FR-9) |
| Persona ofensiva criada por usuário | Mesmas `safetySettings` já aplicadas; conteúdo é responsabilidade de quem cria (igual ao texto livre que já entra no prompt hoje) |
| Colisão de chave com predefinida | Prefixo interno `custom:` + slug por chat |

### Plano de Testes (Vitest)
- `DatabaseService`: CRUD de `custom_personas`, `UNIQUE`, contagem, deleção.
- `PersonalityManager`: merge predefinida+custom; resolução de `getPersonaConfig`; `setPersonality` com chave custom; `deletePersona` com fallback da ativa.
- `PersonaGenerator`: parsing de JSON válido/inválido (mock do `aiService`), aplicação de limites, anexar trait de formato, geração de slug único.
- `LumaPlugin`: roteamento dos subcomandos `criar`/`deletar`; teto de 10; menu unificado.
- `ToolDispatcher`: `handleCreatePersona` chama o gerador e ativa.
- **Não** alterar nem remover testes existentes (CLAUDE.md). Só adicionar.

## Success Metrics

- **Confiabilidade da IA ≥ 95%:** taxa de geração bem-sucedida (JSON válido e dentro dos limites no 1º try ou após 1 retry) ≥ 95% das tentativas de criação.
- **Baixo atrito:** persona criada **e** ativada em uma única mensagem do usuário, sem passo de confirmação.
- **Zero regressão:** seleção de persona predefinida e o output de `PromptBuilder` permanecem idênticos ao comportamento atual (sem teste vermelho na suíte existente).

## Open Questions

- Nenhuma bloqueante. Decisões de escopo resolvidas no levantamento (ver tabela de Decisões).
- Acompanhamento pós-MVP: avaliar se a edição de persona (hoje fora do escopo) é demandada o suficiente para virar feature.

## Critérios de Aceite (entrega)

1. Todos os testes (novos e existentes) passando — `npx vitest run`.
2. `!persona criar <desc>` cria, persiste e ativa a persona no chat.
3. A tool `create_persona` faz o mesmo via linguagem natural.
4. `!persona` lista predefinidas + custom do chat, com custom deletáveis.
5. `!persona deletar pN` remove só custom; predefinida recusa; ativa deletada → padrão.
6. Teto de 10/chat respeitado, com mensagem clara.
7. Falha de IA não grava nada e não quebra o chat.
8. Documentação atualizada: doc do COMO em `docs/`, ADR do PORQUE (decisão de persistir personas por-chat no banco), entrada no `CHANGELOG.md`.
