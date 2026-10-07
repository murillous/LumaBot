---
'@zapforge/core': minor
---

Novo evento `connection.pairing-code` (`{ code }`, ADR 0050): o transport que pareia por código o
emite no lugar do `connection.qr`. O bot o trata como o QR: conta para o `maxQrCount` da
reconexão, loga o valor só em `debug` e o repassa ao barramento.
