---
'@zapforge/core': minor
---

Pipeline de middlewares em onion com prioridade (`MiddlewarePipeline`) e os middlewares
oficiais: `ignoreSelf`, `rateLimit` (com expiração das janelas, via `RateLimiter`), `sanitize`
e `chatFilter` (allow/blocklist de chats).
