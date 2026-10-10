---
'@zapforge/core': minor
---

Vários bots num storage (ADR 0075): `ctx.storage.shared` guarda dados do plugin comuns a todas as
sessões que dividem o storage (um bot por transport: WhatsApp, Telegram, web), no namespace
`$shared:<plugin>`, e segue o tenant como o `ctx.storage`. `ctx.transportName` traz o nome do
transport do bot, para compor a chave do escopo comum quando ela vem de um ID. Mudança aditiva:
`ctx.storage` passa a ser `PluginContextStorage` (`TenantStorage` com `shared`).
