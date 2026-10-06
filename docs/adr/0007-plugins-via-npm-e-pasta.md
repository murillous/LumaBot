# ADR 0007 — Plugins via npm e via pasta (`pluginDirs`)

**Status:** Aceito (2026-10-06) · Decisão **D07** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

No LumaBot o registro de plugins é hardcoded: `MessageHandler.buildPluginManager()`
importa `LumaHandler`, `AudioTranscriber` e `env`. Quem consome o kernel precisa de
duas formas de carregar plugins: pacotes publicados (comunidade, comerciais) e
plugins locais do próprio projeto.

Alternativas consideradas: só npm; só auto-discovery.

## Decisão

Plugins entram por **config** (pacotes npm instanciados em `plugins: [...]`) e por
**pasta** (`pluginDirs`). Os dois caminhos produzem o mesmo objeto `Plugin`. Três
regras:

1. Ordem explícita via `priority` / `after`.
2. `name` obrigatório; enable/disable por nome (`disabledPlugins`).
3. Conflito de nome ou de comando = **erro no boot**.

## Consequências

- O core não importa nenhuma feature.
- A ordem é determinística; nada depende da ordem do sistema de arquivos.
- Conflitos aparecem no boot, não como comportamento estranho em produção.
