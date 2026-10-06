# ADR 0001 — Personas customizadas persistidas por chat no `luma_private.sqlite`

**Status:** Aceito (2026-06-17)

## Contexto

A Luma tinha apenas personas **predefinidas**, codificadas em
`src/config/lumaConfig.js`. Surgiu o requisito de deixar qualquer membro de um
chat criar uma persona nova a partir de uma descrição livre (via `!persona criar`
ou da tool `create_persona`), com a Luma virando esse personagem na hora.

Isso levanta três forças:

1. **Onde persistir** — a persona precisa sobreviver a reinícios do bot e ser
   resolvida no fluxo vivo de mensagens.
2. **Escopo** — uma persona criada num grupo não deve "vazar" para outros chats
   nem virar global; cada chat tem sua própria identidade da Luma.
3. **Privacidade** — o projeto mantém um **banco duplo** (ver
   [`docs/04-banco-dados.md`](../04-banco-dados.md)): `luma_metrics.sqlite`
   (público, versionado, sem dados pessoais) e `luma_private.sqlite` (nunca
   versionado, contém JIDs). A persona é associada a um `chat_jid` e seu conteúdo
   é gerado por usuários — logo é dado privado.

Alternativas consideradas:

- **Arquivo de config / override JSON** (como `config-overrides.json`): simples,
  mas não tem escopo por chat, não versiona bem dado de usuário e mistura config
  de operação com conteúdo gerado em runtime.
- **Personas globais numa tabela sem `chat_jid`**: quebra o isolamento entre
  chats — um grupo sobrescreveria a Luma de outro.
- **Tabela nova no `luma_private.sqlite` com `chat_jid`** (escolhida).

## Decisão

Persistir personas custom numa tabela `custom_personas` no
**`luma_private.sqlite`**, chaveada por `chat_jid`, com `UNIQUE (chat_jid, key)`
e índice `idx_custom_personas_chat`. O `DatabaseService`
(`src/services/Database.js`) ganha o CRUD estático
(`createCustomPersona` / `getCustomPersonas` / `getCustomPersona` /
`deleteCustomPersona` / `countCustomPersonas`), seguindo o mesmo padrão das demais
tabelas.

A resolução de persona passa pelo `PersonalityManager` na ordem **custom do chat →
predefinida → `DEFAULT_PERSONALITY`**. A key custom carrega um prefixo interno
`custom:` em `chat_settings.personality` / `getList` para nunca colidir com
predefinidas; o slug puro é o que vai ao CRUD.

Para telemetria, **só** os contadores agregados `personas_created` e
`personas_deleted` vão ao banco **público** — sem JID nem conteúdo.

## Consequências

**Mais fácil:**

- Isolamento natural por chat (cada `JID` tem suas personas e sua ativa).
- Conteúdo privado fica no banco que já é não-versionado e fora do Git.
- Reusa o `DatabaseService` e o padrão de banco duplo já estabelecidos — sem
  novos mecanismos de persistência.
- Predefinidas continuam imutáveis (vivem em código); custom são deletáveis sem
  tocar no código.

**Mais difícil / trade-offs:**

- Personas não são portáveis entre chats nem versionadas — quem trocar de grupo
  recria. (Aceitável: é o comportamento desejado de isolamento.)
- O teto de 10 custom por chat é uma salvaguarda fixa; aumentar exige mudança de
  código.
- A convenção do prefixo `custom:` precisa ser respeitada nos dois lados
  (prefixado no `chat_settings` / `getList`, puro no CRUD) — um ponto de atenção
  para futuras mudanças.

Substituível por um ADR futuro caso surja necessidade de personas globais,
compartilháveis ou exportáveis.
