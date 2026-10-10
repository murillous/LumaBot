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
não pode ter campo `messages`, que é reservado para sobrescrever textos. `secret()` só vale em
campo de `z.object` (em qualquer nível de objetos), e dois campos não podem gerar a mesma
variável de ambiente (ver abaixo). Plugin sem `config`
recebe `ctx.config === undefined`, e qualquer campo dado a ele é erro.

## Camadas e precedência

**env > arquivo > overrides (storage) > default do schema**, campo a campo; objetos aninhados se
mesclam entre camadas, arrays e valores simples substituem.

| Camada | De onde vem |
| --- | --- |
| env | `ZAPFORGE_<PLUGIN>__<CAMPO>[__<SUBCAMPO>…]` |
| arquivo | `file[plugin]` — o `pluginConfig` que o app passa na config do bot |
| overrides | `kernelStorage(storage, 'config').kv`, chave = nome do plugin (dashboard); nunca segredos |
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

Só campos declarados no schema são lidos. O texto é
convertido para o tipo do campo: número (`'42'`), booleano (`true/false`, `1/0`, `yes/no`,
`on/off`), literal, e JSON para arrays, records e uniões (`'["a","b"]'`). Texto que não converte
segue cru e o Zod rejeita, apontando a variável.

Dois caminhos que geram a mesma variável — `openAIKey` e `openAiKey` viram ambos `OPEN_AI_KEY` —
são erro do autor: o plugin é recusado com a variável e os campos em conflito, em vez de uma
variável preencher os dois. Vale também para as chaves de `messages`.

O ambiente é injetável (`env`); sem ele, vale `process.env`, lido só em `src/config/`.

## `createPluginConfigs`

O `Bot` faz isto no `start()` com `pluginConfig`, `storage`, `env` e `secrets` da config dele, e
expõe `setOverrides`/`describe`/`jsonSchema` em `bot.config`. Por dentro (interno do kernel, não exportado ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md))):

```ts
import { createLogger, createSecretSet } from '@zapforge/core';
import { createPluginConfigs } from '#config/plugin-configs.ts';

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
| `setOverrides(name, overrides)` | Recusa campo `secret`; valida a config resultante; se válida, salva (substitui; `{}` remove) e chama `reload`. Inválida rejeita sem salvar. Campo sombreado gera `warn` (abaixo) |
| `describe(name)` | `{ config, messages, sources }`: config atual com segredos trocados por `'********'` e a fonte de cada campo |
| `jsonSchema(name)` | JSON Schema (entrada) para gerar formulário; segredos com `x-zapforge-override: false`; `undefined` sem `config` |

`pluginConfig` citando plugin que não existe gera `warn` (provável erro de digitação).

### Override sombreado

Override perde para o arquivo e o env. Um `setOverrides` num campo que o `pluginConfig` ou uma
variável já definem é salvo (passa a valer se a camada de cima sair), mas não muda nada agora.
Para o dashboard não mostrar "salvo" em silêncio:

- `setOverrides` loga um `warn` com plugin e os campos sombreados (`fields: [{ path, source }]`),
  sem os valores;
- `describe` devolve `sources`, o mapa caminho → fonte (`'default' | 'override' | 'file' | 'env'`)
  de cada folha da config e de cada mensagem:

```ts
const { sources } = await bot.config.describe('sticker');
// { quality: 'file', 'openai.token': 'env', 'messages.done': 'override', … }
```

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
- Schema que não é `z.object`, com campo `messages`, com `secret()` fora de campo de objeto ou
  com dois campos na mesma variável de ambiente é erro do autor do plugin (`TypeError`): no boot,
  o plugin é ignorado com o motivo na tabela.

## Segredos

`secret(schema)` marca o campo (em qualquer nível de objetos, sobrevive a
`.optional()`/`.default()`). Dentro de array, record ou union ele é recusado, com o caminho
(`accounts[*].token`): a config só acha segredo seguindo objetos, e ali ele passaria sem
censura, sem máscara e aceito por override. Para uma lista secreta, marque o campo inteiro:
`tokens: secret(z.array(z.string()))`. Um campo secreto tem estas garantias:

- `describe` mostra `'********'`;
- o JSON Schema sai com `secret: true`, `writeOnly: true` e `x-zapforge-override: false` (o
  dashboard não deve oferecer edição), e um `default` secreto vira máscara;
- `resolve`/`setOverrides` põem os valores no `SecretSet` (dono `plugin:<nome>`, trocados a cada
  resolução). O logger criado com `secrets: secretSet` censura esses valores em qualquer linha —
  mesmo os resolvidos depois da criação do logger ou alterados num reload. Ver
  [Logger](logger.md#segredos). Um segredo com menos de 4 caracteres não
  é censurado; a resolução avisa uma vez por campo, com plugin e caminho (nunca o valor).

### Segredo não entra por override

O override fica em texto puro no storage (banco, backups), então segredo vem **só de env ou do
arquivo** ([ADR 0032](../../../docs/adr/0032-camadas-da-config-de-plugin.md)):

```ts
await configs.setOverrides('ai', { model: 'pro', openai: { token: 'x' } });
// PluginConfigError, nada é salvo e o plugin segue com a config atual:
// - openai.token: campo secreto não pode ser definido por override (o storage guarda em texto
//   puro); defina pela env ZAPFORGE_AI__OPENAI__TOKEN ou pelo arquivo pluginConfig["ai"].openai.token
//   (fonte: override salvo no storage)
```

A checagem vale em qualquer nível de objeto e vem antes da validação. Override **legado** com
segredo (gravado antes desta regra ou escrito direto no banco) não derruba o plugin: em
`resolve`, o campo secreto é descartado e sai um `warn` com plugin e caminho — nunca o valor —,
uma vez por campo; o resto do override vale. Para limpar, grave o override de novo sem o campo.
`describe` mascara o valor; `sources` diz só de onde ele veio (`env` ou `file`).

Cifrar segredos no storage, para o dashboard editá-los, fica para o M5 com ADR próprio.

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

Sem reiniciar o processo. Quem depende do plugin por `dependsOn` recarrega junto, em cascata
([Plugins](plugins.md#recarregar-um-plugin-reload)); os outros ficam intocados. As mudanças são
serializadas. Se o
`reload` rejeitar (ex.: host parado, plugin desabilitado), o override **já foi salvo** e vale no
próximo boot.

## `owners`

Donos do bot (`createBot({ owners })`). Cada entrada é um telefone ou um `{ id }`
([Comandos](commands.md#role),
[ADR 0056](../../../docs/adr/0056-owners-por-telefone-ou-id.md)):

- **Telefone** (string): só dígitos com DDI, como `Contact.phone`, comparado com `sender.phone`.
  Aceita espaço, `+`, `-`, `.`, `(` e `)`; o resto (letras, `@`) é `BotConfigError`, assim
  como menos de 8 ou mais de 15 dígitos.
- **`{ id }`**: o ID nativo do contato, comparado com `sender.id` exatamente como o transport o
  entrega. É o caminho para Discord, Telegram e web, onde não há telefone. Vai sempre em texto
  (um snowflake do Discord perde precisão como número); vazio, com espaço nas pontas ou que não
  é texto é `BotConfigError`.

```ts
createBot({ transport, owners: ['+55 11 99999-9999', '5511999999999'] }); // ['5511999999999']
createBot({ transport, owners: [{ id: '123456789012345678' }] });         // Discord
createBot({ transport, owners: ['5511999999999@s.whatsapp.net'] });        // BotConfigError: ID vai em { id }
```

Telefone e `{ id }` nunca se cruzam: `{ id: '5511999999999' }` não casa com quem tem esse
telefone, nem `'5511999999999'` com quem tem esse ID. Onde a plataforma tem telefone, prefira-o:
no WhatsApp o `sender.id` do mesmo contato muda de espaço conforme o grupo, e um `{ id }` só casa
no espaço em que foi escrito. Repetidos saem, a ordem fica.
