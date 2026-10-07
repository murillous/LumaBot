# Config de plugin: schema, camadas, segredos e reload

Cada plugin declara a config com um schema **Zod 4**; o core junta as camadas, valida, mascara
os segredos e recarrega o plugin quando a config muda
([ADR 0017](../../../docs/adr/0017-config-por-plugin-zod.md),
[ADR 0025](../../../docs/adr/0025-sem-i18n-objeto-messages.md),
[ADR 0032](../../../docs/adr/0032-camadas-da-config-de-plugin.md)).

## Declarar

```ts
import { definePlugin, secret } from '@zapforge/core';
import { z } from 'zod';

export const ai = definePlugin({
  name: 'ai',
  version: '1.0.0',
  engine: '^1.0.0',
  config: z.object({
    model: z.string().default('flash'),
    apiKey: secret(z.string().min(8)),                  // obrigatório e secreto
    openai: z.object({ token: secret(z.string()).optional() }).default({}),
  }),
  messages: { thinking: 'Pensando…' },
  setup(ctx) {
    ctx.config.apiKey;          // string — saída do schema, defaults aplicados
    ctx.plugin.messages.thinking;
  },
});
```

Regras do schema: o tipo base precisa ser `z.object(...)` (pode ter `.default`, `.optional`) e
não pode ter campo `messages`, que é reservado para sobrescrever textos. Plugin sem `config`
recebe `ctx.config === undefined`, e qualquer campo dado a ele é erro.

## Camadas e precedência

**env > arquivo > overrides (storage) > default do schema**, campo a campo; objetos aninhados se
mesclam entre camadas, arrays e valores simples substituem.

| Camada | De onde vem |
| --- | --- |
| env | `ZAPFORGE_<PLUGIN>__<CAMPO>[__<SUBCAMPO>…]` |
| arquivo | `file[plugin]` — o `pluginConfig` que o app passa na config do bot |
| overrides | `kernelStorage(storage, 'config').kv`, chave = nome do plugin (dashboard) |
| default | `.default(...)` do schema |

```ts
// config do app: nome do plugin → campos (+ messages opcional)
const pluginConfig = {
  ai: { model: 'pro', messages: { thinking: 'Um instante…' } },
  sticker: { quality: 90 },
};
```

### Variáveis de ambiente

Plugin kebab-case e campos camelCase viram SCREAMING_SNAKE; `__` separa os níveis:

| Plugin | Campo | Variável |
| --- | --- | --- |
| `sticker` | `quality` | `ZAPFORGE_STICKER__QUALITY` |
| `user-names` | `openai.apiKey` | `ZAPFORGE_USER_NAMES__OPENAI__API_KEY` |
| `ai` | `messages.thinking` | `ZAPFORGE_AI__MESSAGES__THINKING` |

`envName(plugin, path)` devolve o nome. Só campos declarados no schema são lidos. O texto é
convertido para o tipo do campo: número (`'42'`), booleano (`true/false`, `1/0`, `yes/no`,
`on/off`), literal, e JSON para arrays, records e uniões (`'["a","b"]'`). Texto que não converte
segue cru e o Zod rejeita, apontando a variável.

O ambiente é injetável (`env`); sem ele, vale `process.env`, lido só em `src/config/`.

## `createPluginConfigs`

```ts
import { createLogger, createPluginConfigs, createSecretSet } from '@zapforge/core';

const secrets = createSecretSet();
const log = createLogger({ secrets });          // mesma fonte de segredos
const configs = createPluginConfigs({
  plugins,                                      // PluginDefinition[]
  file: pluginConfig,                           // opcional
  storage,                                      // StoragePort (overrides)
  secrets,                                      // opcional, recomendado
  reload: (name) => host.reload(name),          // opcional: reload ao mudar override
  log,                                          // opcional: avisos
  env,                                          // opcional: padrão process.env
});
```

| Método | O que faz |
| --- | --- |
| `resolve(name)` | `{ config, messages }` atuais e validados; registra os segredos no `SecretSet`. Lança `PluginConfigError` |
| `setOverrides(name, overrides)` | Valida a config resultante; se válida, salva (substitui; `{}` remove) e chama `reload`. Inválida rejeita sem salvar |
| `describe(name)` | Config atual com segredos trocados por `SECRET_MASK` (`'********'`) |
| `jsonSchema(name)` | JSON Schema (entrada) para gerar formulário; `undefined` sem `config` |

`pluginConfig` citando plugin que não existe gera `warn` (provável erro de digitação).

### Na fábrica de contexto

`resolve` é o que a `createContext` do host chama a cada setup — inclusive no reload, que assim
pega a config nova:

```ts
const createContext: PluginContextFactory = async (plugin) => {
  const { config, messages } = await configs.resolve(plugin.name);
  return {
    context: { plugin: { name: plugin.name, version: plugin.version, messages }, config, /* … */ },
    dispose: () => { /* … */ },
  };
};
```

## Erros

`PluginConfigError` lista **todos** os problemas, cada um com `path`, `message` e `source`
(`env` — com `env` = nome da variável —, `file`, `override` ou `default` = valor ausente sem
default):

```
config inválida do plugin "sticker":
- quality: Too big: expected number to be <=100 (fonte: arquivo pluginConfig["sticker"].quality)
- apiKey: Invalid input: expected string, received undefined (fonte: ausente, sem default no schema)
```

A mensagem nunca traz o valor recebido (pode ser secreto).

- **No boot**: a fábrica que lança faz o plugin ser **ignorado** (`setup-failed`, fase `context`),
  com o erro na tabela de boot; o resto sobe.
- **Em runtime**: `setOverrides` inválido rejeita, nada é salvo e o plugin segue com a config
  anterior.
- Schema que não é `z.object` ou com campo `messages` é erro do autor do plugin (`TypeError`).

## Segredos

`secret(schema)` marca o campo (em qualquer nível, sobrevive a `.optional()`/`.default()`):

- `describe` mostra `'********'`;
- o JSON Schema sai com `secret: true` e `writeOnly: true`, e um `default` secreto vira máscara;
- `resolve`/`setOverrides` põem os valores no `SecretSet` (dono `plugin:<nome>`, trocados a cada
  resolução). O logger criado com `secrets: secretSet` censura esses valores em qualquer linha —
  mesmo os resolvidos depois da criação do logger ou alterados num reload. Ver
  [Logger](logger.md#segredos).

Overrides ficam em texto puro no storage, segredos inclusive.

## `messages` sobrescrevível

A chave `messages` da entrada (arquivo, override ou `ZAPFORGE_<PLUGIN>__MESSAGES__<CHAVE>`)
sobrescreve textos do manifesto, com a mesma precedência dos campos. O resultado mesclado é
`ctx.plugin.messages` (congelado). Chave que o manifesto não declara, ou valor que não é texto,
é `PluginConfigError` com a lista de chaves válidas.

## Reload

```ts
await configs.setOverrides('ai', { model: 'pro' });
// valida → salva → reload('ai'): teardown → dispose → contexto novo (resolve) → setup
```

Sem reiniciar o processo e sem tocar nos outros plugins. As mudanças são serializadas. Se o
`reload` rejeitar (ex.: host parado, plugin desabilitado), o override **já foi salvo** e vale no
próximo boot.

## `owners`

Telefones dos donos do bot, só dígitos com DDI, como `Contact.phone`:

```ts
normalizeOwners(['+55 11 99999-9999', '5511999999999']); // ['5511999999999']
normalizePhone('5511999999999@s.whatsapp.net');         // BotConfigError
```

Aceita espaço, `+`, `-`, `.`, `(` e `)`; o resto (letras, `@` de JID) é `BotConfigError`, assim
como menos de 8 ou mais de 15 dígitos. Repetidos saem, a ordem fica.
