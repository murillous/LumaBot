---
'@zapforge/testing': minor
---

O `receive()` aceita `attachments` depois da mídia principal, com o tipo novo `IncomingAttachment`
(os bytes, ou os bytes com `mimetype` e `fileName`), para testar mensagens com vários anexos
(ADR 0065).
