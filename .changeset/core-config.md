---
'@zapforge/core': minor
---

Config por plugin (M1-13): `createPluginConfigs()` valida a config de cada plugin com o schema
Zod do manifesto, com precedência env (`ZAPFORGE_<PLUGIN>__<CAMPO>`, com coerção de tipo) >
arquivo (`pluginConfig`) > overrides no storage > default; `PluginConfigError` lista campo e
fonte de cada problema. Campos `secret()` são mascarados em `describe()`, marcados no JSON
Schema exportado (`jsonSchema()`) e nunca logados: o logger aceita um `SecretSet`
(`createSecretSet()`) consultado a cada linha, para segredos resolvidos ou alterados depois da
criação. `setOverrides()` valida antes de salvar e dispara o reload do plugin (`teardown` →
`setup`). `messages` sobrescrevível pela config, com erro para chave desconhecida.
`normalizeOwners()`/`normalizePhone()` normalizam os telefones de `owners`.
