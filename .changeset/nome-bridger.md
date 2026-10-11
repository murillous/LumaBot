---
"@usebridger/core": patch
"@usebridger/storage-postgres": patch
"@usebridger/storage-sqlite": patch
"@usebridger/testing": patch
"@usebridger/transport-baileys": patch
"@usebridger/transport-web": patch
"create-bridger-plugin": patch
---

O projeto se chama Bridger, com os pacotes no escopo `@usebridger/*` e o scaffold `create-bridger-plugin` (ADR 0083). A config de plugin lê variáveis com prefixo `BRIDGER_`, a anotação de campo não editável por override é `x-bridger-override`, plugins seguem o prefixo `bridger-plugin-` e o schema Postgres padrão é `bridger`. O repositório passa a ser `murillous/usebridger`.
