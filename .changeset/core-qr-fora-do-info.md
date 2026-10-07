---
'@zapforge/core': patch
---

O QR de pareamento não sai mais inteiro no log em `info`: o aviso continua em `info` e o valor (campo `qr`) passou para `debug`. Quem lê o log (agregador, arquivo, dashboard) conseguia parear o número enquanto o QR valia. O barramento `connection.qr` segue com o valor.
