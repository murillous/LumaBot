# ADR 0003 — `Transport` abstrato, só Baileys na v1

**Status:** Aceito (2026-10-06) · Decisão **D03** do [plano](../../ZAPFORGE_PLAN.md#4-decisões) · "Só Baileys na v1": substituído pelo [ADR 0055](0055-plataformas-alvo-e-transport-web.md)

## Contexto

O LumaBot fala diretamente com o Baileys, e o `MessagingPort` vaza o socket para
`GroupService`, `LumaHandler`, `ToolDispatcher` e `SpontaneousHandler`. O uso
comercial futuro exige outros canais: Cloud API oficial do WhatsApp, Twilio e Zenvia.

Alternativas consideradas: multi-transporte já na v1; expor o Baileys diretamente.

## Decisão

O core define uma interface `Transport` com capabilities (ver
[ADR 0010](0010-capabilities-do-transporte.md)). A v1 entrega **só**
`@zapforge/transport-baileys`; os demais transports viram adapters depois, os
comerciais em repo privado (ver [ADR 0029](0029-open-core-repo-privado.md)).

## Consequências

- A abstração custa pouco agora e evita reescrever plugins quando surgir o segundo
  transporte.
- Com um único adapter, há risco de a interface ficar com o formato do Baileys;
  o modelo de mensagem normalizado ([ADR 0009](0009-modelo-de-mensagem-normalizado.md))
  e as capabilities limitam esse risco.
- O core não importa nenhum transport concreto.
