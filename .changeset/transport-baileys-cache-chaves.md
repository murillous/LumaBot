---
'@zapforge/transport-baileys': patch
---

As chaves do auth state passam por um cache em memória por tentativa de conexão
(`makeCacheableSignalKeyStore` do Baileys): leituras repetidas não vão mais ao storage. As
gravações seguem indo ao storage na hora.
