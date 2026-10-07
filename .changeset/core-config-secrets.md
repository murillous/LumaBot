---
'@zapforge/core': minor
---

Segredos não entram mais por override de config (M1-13): `setOverrides` recusa qualquer campo
`secret`, inclusive aninhado, com `PluginConfigError` (fonte `override`) que aponta a variável
`ZAPFORGE_<PLUGIN>__<CAMPO>` e o caminho no arquivo; nada é salvo e o plugin segue com a config
atual. Override legado com segredo no storage tem o campo ignorado em `resolve`, com aviso no log
sem o valor. O JSON Schema de `jsonSchema` marca os campos secretos com
`x-zapforge-override: false`.
