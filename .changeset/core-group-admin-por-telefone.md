---
'@zapforge/core': patch
---

`role: 'group-admin'` reconhece o admin também pelo telefone (#238, ADR 0046). No WhatsApp, o
remetente pode chegar como LID e os participantes do `getGroupMetadata` como JID de telefone (ou
o contrário): o id não batia e um admin de verdade era recusado em silêncio. Agora casa por `id`
ou, quando os dois lados têm `phone`, pelo telefone; sem telefone de um lado, só o `id` decide.
O contrato do `Transport` passa a documentar que ids de contato podem vir em espaços diferentes,
que o adapter preenche `phone` sempre que souber e que `getGroupMetadata` deve ser barato (cache
no adapter, invalidado por `group.participants`/`group.updated`).
