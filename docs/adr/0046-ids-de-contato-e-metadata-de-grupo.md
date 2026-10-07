# ADR 0046 — Ids de contato em espaços diferentes e custo do `getGroupMetadata`

**Status:** Aceito (2026-10-07) · Detalha **D03** ([ADR 0003](0003-transport-abstrato.md)) e
**D09** ([ADR 0009](0009-modelo-de-mensagem-normalizado.md))

## Contexto

O papel `group-admin` comparava só o id: `participant.id === sender.id`. No WhatsApp, o
`sender.id` de uma mensagem de grupo pode chegar como LID enquanto os participantes do
`getGroupMetadata` vêm como JID de telefone, ou o contrário, conforme o modo de endereçamento
do grupo. Nesse caso um admin de verdade era recusado em silêncio (#238). Os owners já eram
reconhecidos por telefone pelo mesmo motivo (M1-16.4); o `group-admin` tinha ficado de fora.

O contrato do `Transport` não dizia em que espaço vêm os ids de contato (`sender.id`,
`GroupParticipant.id`, `mentions`, os ids de `updateGroupParticipants`) nem se coincidem. Também
não dizia quanto custa um `getGroupMetadata`, chamado a cada comando `group-admin` de quem não é
owner: sem cache, cada um vira uma ida à rede do WhatsApp, com latência no chat e tráfego que
conta para o anti-ban.

Alternativas consideradas:

- **Exigir que o transport normalize todos os ids para um espaço só.** Põe tudo no adapter, que
  nem sempre tem o mapeamento LID ↔ telefone (o Baileys só conhece o que já viu). Quando não
  tem, o core voltaria a recusar o admin sem saber por quê.
- **Cache de metadados no core**, invalidado pelos eventos `group.*`. Estado novo no kernel, e o
  ADR 0040 decidiu "sem cache" para `ctx.groups.metadata`. O Baileys já oferece cache próprio
  (`cachedGroupMetadata`), então o adapter cacheia com menos código.

## Decisão

- O `group-admin` reconhece o participante admin por **id ou telefone**: casa quando
  `participant.id === sender.id` ou quando os dois lados têm `phone` e ele é igual. Sem telefone
  de um lado, só o id decide (fail-closed, como os owners).
- A porta interna `isGroupAdmin` do roteador recebe o `Contact` do remetente, não só o id. A API
  pública não muda.
- O contrato documenta que ids de contato podem vir em espaços diferentes (LID, JID de
  telefone) e que o adapter preenche `phone` no remetente e nos participantes sempre que souber
  resolvê-lo. Quem compara contatos num plugin (menções contra participantes, por exemplo) usa a
  mesma regra.
- O contrato documenta que `getGroupMetadata` pode ser chamado a cada comando `group-admin` e
  precisa ser barato: o adapter mantém cache por grupo, invalidado por `group.participants` e
  `group.updated`. O core continua sem cache (ADR 0040).

## Consequências

- Admin com LID passa no `group-admin` sempre que o adapter resolve o telefone dos dois lados.
- O adapter Baileys (M2-1) tem dois deveres explícitos: preencher `phone` (mapeamento LID ↔
  telefone) e cachear os metadados do grupo.
- Um remetente sem telefone resolvido e com id em outro espaço continua recusado: falta
  informação, e o papel falha fechado.
