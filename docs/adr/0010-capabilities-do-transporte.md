# ADR 0010 — Capabilities do transporte + `requires`

**Status:** Aceito (2026-10-06) · Decisão **D10** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Transports diferentes suportam coisas diferentes (figurinhas, enquetes, administração
de grupo). Reduzir todos ao mínimo denominador comum castraria o Baileys; deixar o
erro só para runtime faria o plugin quebrar no meio de uma conversa. A analogia é a
dos mods de Minecraft sobre Fabric/Forge.

Alternativas consideradas: mínimo denominador comum; só erro em runtime.

## Decisão

Cada transport declara suas **capabilities** (ex.: `groups`, `send.sticker`,
`media.download`, `polls` — [plano §6.10](../../ZAPFORGE_PLAN.md#610-capabilities-iniciais-do-baileys)).
O plugin declara `requires`. O kernel **não carrega** um plugin incompatível, com
aviso no boot, e lança `UnsupportedError` em runtime como rede de segurança.

## Consequências

- O erro aparece cedo e explícito.
- A lista de capabilities passa a ser API pública e precisa ser versionada com cuidado.
