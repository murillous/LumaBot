# Schemas: o que o core valida

Os formatos de dados que entram no core, quem os confere, quando, e o erro de cada um. O detalhe
de cada campo fica no guia do módulo; aqui fica o mapa.

| Formato | Tipo | Conferido por | Quando | Erro |
| --- | --- | --- | --- | --- |
| [Manifesto do plugin](#manifesto-do-plugin) | `PluginDefinition` | `definePlugin` e o loader | ao declarar; no boot, para plugins de `pluginDirs` | `PluginManifestError`, derruba o boot |
| [Compatibilidade do plugin](#compatibilidade-do-plugin) | campos do manifesto | host de plugins | no boot | plugin ignorado, na tabela de boot |
| [Config do plugin](#config-do-plugin) | schema Zod do plugin | config de plugin | no `setup`, no reload e em `setOverrides` | `PluginConfigError` |
| [Config do bot](#config-do-bot) | `BotConfig` | `createBot` | ao criar o bot | `BotConfigError`, `TypeError`, `RangeError` |
| [Comando](#comando) | `CommandDefinition` | `command()` e `ctx.commands.add` | ao declarar e ao registrar | `TypeError`/`RangeError`; conflito: `CommandConflictError` |
| [Mensagem](#mensagem) | `Message` | `createMessage` (transport) | ao montar a mensagem | `TypeError` (mídia e anexos incoerentes) |
| [Valores de storage](#valores-de-storage) | `JsonValue`, `FindQuery` | normalização do core, antes do adapter | em cada operação | `TypeError` / `RangeError` |
| [Capabilities](#capabilities) | `Capability` | `definePlugin`, `defineTransport`, `createBot`, envio | ao declarar, ao criar o bot e no envio | `PluginManifestError`, `TypeError`, `BotConfigError`, `UnsupportedError` |

## Manifesto do plugin

`definePlugin` confere o manifesto na hora e lança `PluginManifestError` com **todos** os
problemas, um por linha (`issues`). O plugin de `pluginDirs` passa pela mesma checagem no boot,
com o caminho do módulo em `origin`. Manifesto inválido derruba o boot antes de o transport
conectar.

| Campo | Obrigatório | Formato |
| --- | --- | --- |
| `name` | sim | kebab-case minúsculo começando por letra, até 64 caracteres |
| `version` | sim | semver exato |
| `engine` | sim | faixa semver do core |
| `requires` | não | lista de [capabilities](#capabilities) |
| `transports` | não | lista não vazia de nomes de transport |
| `dependsOn` | não | nome de plugin → faixa semver |
| `after` | não | lista de nomes de plugin |
| `priority` | não | número finito; padrão 0 |
| `config` | não | schema Zod ([abaixo](#config-do-plugin)) |
| `messages` | não | chave → texto |
| `commands` | não | nome → comando sem `name`, com `run` |
| `on` | não | evento de `BotEvents` → função |
| `setup` | sem `commands` nem `on` | função |
| `teardown` | não | função |

Regras de cada campo, faixas semver aceitas e a forma curta (`commands`/`on`):
[Plugins → Declarar](plugins.md#declarar-um-plugin).

## Compatibilidade do plugin

Um manifesto válido ainda pode não carregar. No boot o host confere, nesta ordem, e para no
primeiro motivo: `disabledPlugins`, `engine` contra `CORE_VERSION`, `transports` contra o
transport ativo, `requires` contra as capabilities dele e as dependências de `dependsOn`. O
plugin incompatível é ignorado e aparece na tabela de boot com o motivo (`PluginSkipReason`); o
bot sobe sem ele. Ver [Plugins → Boot](plugins.md#boot-start).

## Config do plugin

O schema é Zod 4, com tipo base `z.object(...)` e sem campo `messages` (reservado). `secret()`
marca um campo como segredo. O valor final sai de quatro camadas, campo a campo:
**env > arquivo > overrides > default**.

```ts
// Arquivo: o `pluginConfig` da config do bot (`PluginConfigFile`)
const pluginConfig = {
  sticker: { quality: 90, messages: { needMedia: 'Mande uma imagem' } },
};
// Env: ZAPFORGE_<PLUGIN>__<CAMPO>[__<SUBCAMPO>…]
// ZAPFORGE_STICKER__QUALITY=90
```

| Quando | O que acontece com config inválida |
| --- | --- |
| Boot ou reload | `PluginConfigError` no `setup`: o plugin fica `setup-failed` e o bot sobe sem ele |
| `bot.config.setOverrides` | Rejeita com `PluginConfigError` e nada é salvo; o plugin segue com a config atual |

`PluginConfigError` lista todos os problemas, cada um com `path`, `message` e `source` (`env`,
`file`, `override` ou `default`).

**JSON Schema para o dashboard.** `bot.config.jsonSchema(nome)` devolve o schema de **entrada**
(campo com default é opcional), gerado pelo `toJSONSchema` do Zod. Campo `secret()` sai com
`secret: true`, `writeOnly: true` e `x-zapforge-override: false`, e o `default` dele trocado por
`'********'`. Transform, que não tem JSON Schema, vira `{}`. Plugin sem `config` devolve
`undefined`.

Camadas, variáveis de ambiente, segredos e reload: [Config](config.md).

## Config do bot

`createBot` valida a config antes de qualquer efeito:

| O que | Erro |
| --- | --- |
| `session` fora de kebab-case | `BotConfigError` |
| `owners` com telefone malformado | `BotConfigError` |
| Fábrica de transport que lança | `BotConfigError` |
| Transport sem `name`, sem os métodos obrigatórios, ou com capability desconhecida ou sem o método dela ([ADR 0080](../../../docs/adr/0080-acucar-para-o-autor-de-transport.md)) | `BotConfigError` |
| Opção fora do domínio (prefixo começado por espaço, `maxPendingPerChat` negativo, prioridade `NaN`...) | `TypeError` / `RangeError` |

As opções e seus padrões: [Bot → `createBot(config)`](bot.md#createbotconfig).

## Comando

`command()`, o `commands` do manifesto e `ctx.commands.add` conferem a mesma coisa: nome e
aliases sem espaço e não vazios (`TypeError`) e `timeoutMs` finito e maior que zero
(`RangeError`). Nome ou alias já usado por outro plugin é `CommandConflictError`, que derruba o
boot. Ver [Comandos](commands.md#declarar-um-comando) e [Conflitos](commands.md#conflitos).

## Mensagem

O modelo neutro (`Message`, `Contact`, `Chat`, `Media`) é o mesmo em toda plataforma. Quem monta a
mensagem é o transport, com `createMessage`, que preenche os campos opcionais e recusa mídia e
anexos incoerentes (anexos numa mensagem sem mídia, `attachments` que não começa pela `media`).
O plugin só lê. Ver [Modelo de mensagem](message.md).

## Valores de storage

KV e coleções guardam JSON (`JsonValue`) com a semântica do `JSON.stringify` (`undefined` some,
`Date` vira texto), e o valor entra e sai como cópia. Consultas (`FindQuery`: `where`, `orderBy`,
`limit`, `offset`) são normalizadas pelo core antes de chegar ao adapter, com os mesmos operadores
e erros em todo banco: operador ou campo inválido é `TypeError`, `limit`/`offset` negativo ou
fracionário é `RangeError`. Ver [Storage](storage.md#valores-são-json-e-sempre-cópias) e
[Erros](storage.md#erros).

## Capabilities

A lista fechada (`CAPABILITIES`) é a mesma para `requires` do plugin e para as `capabilities` do
transport. Nome desconhecido é recusado no manifesto (`PluginManifestError`). No transport,
capability desconhecida ou sem o método dela é recusada pelo `defineTransport`
(`TypeError`) e pelo `createBot` (`BotConfigError`). Usar uma capability que o transport não
declarou lança `UnsupportedError`.

`actions`, `groups`, `groups.add`, `groups.remove`, `groups.promote`, `mentions`, `reactions`,
`typing`, `send.text`, `send.image`, `send.video`, `send.audio`, `send.voice`, `send.sticker`,
`send.document`, `send.album`, `media.download`, `message.edit`, `message.delete`, `polls`,
`quoted`, `pairing`.

O que cada uma significa: [Transport → Capabilities](transport.md#capabilities).
