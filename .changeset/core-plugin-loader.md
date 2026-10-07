---
'@zapforge/core': minor
---

Loader e lifecycle de plugins (M1-8): `definePlugin` com config tipada pelo schema Zod e
validação de manifesto (`name` kebab-case, `version`, `engine`, `requires`, `transports`,
`dependsOn`); fontes da config e de `pluginDirs` (`collectPlugins` / `discoverPlugins`); ordem
topológica por `dependsOn`/`after` com desempate por `priority` e `PluginCycleError`;
`createPluginHost` com `disabledPlugins`, tabela de boot "carregado / ignorado (motivo)",
`setup`/`teardown` com timeout e `reload` de um plugin; `CORE_VERSION`, `satisfies` e
`isValidRange` (semver próprio, sem dependência nova).
