# ADR 0024 — Papéis no core

**Status:** Aceito (2026-10-06) · Decisão **D24** do [plano](../../ZAPFORGE_PLAN.md#4-decisões) · Papéis custom: substituído pelo [ADR 0035](0035-papeis-nomeados-por-plugin.md) · Allow/blocklist: detalhado pelo [ADR 0038](0038-filtro-de-eventos-no-kernel.md)

## Contexto

No LumaBot, qualquer pessoa pode alterar personas e configurações. Comandos
administrativos precisam de controle de acesso, e reimplementá-lo em cada plugin
seria inconsistente.

Alternativas consideradas: sem papéis.

## Decisão

O roteador do core verifica papéis: `owner` / `group-admin` / `everyone`, declarados
no comando (`role`). Allow/blocklist de chats é um middleware oficial. Papéis
custom são feitos via middleware de plugin.

## Consequências

- Controle de acesso consistente em todos os plugins.
- `group-admin` depende da capability `groups`.
- `owners` vira campo da config do bot.
