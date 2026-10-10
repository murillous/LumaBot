# Config

O plugin declara o que é configurável com um schema [Zod 4](https://zod.dev). O kernel junta o que
o dono do bot definiu, valida, esconde os segredos no log e entrega a config tipada em `ctx.config`.
O detalhe está em [Config no core](../../packages/core/docs/config.md).

## Declarar

```ts
import { definePlugin, secret } from '@zapforge/core';
import { z } from 'zod';

export const clima = definePlugin({
  name: 'clima',
  version: '0.1.0',
  engine: '<1.0.0',
  config: z.object({
    cidade: z.string().default('São Paulo'),
    unidade: z.enum(['C', 'F']).default('C'),
    apiKey: secret(z.string().min(8)), // obrigatório: sem default, o plugin não sobe sem ele
  }),
  messages: {
    semDados: 'Não consegui ver o clima agora.',
  },
  commands: {
    clima: {
      run: async (c, { config, plugin }) => {
        const cidade = c.rawArgs || config.cidade;
        const graus = await buscarClima(cidade, config.apiKey, { signal: c.signal });
        if (graus === null) return plugin.messages.semDados;
        return `${cidade}: ${graus}°${config.unidade}`;
      },
    },
  },
});
```

- **`ctx.config` sai do schema**, com os defaults aplicados. No exemplo, `config.unidade` é
  `'C' | 'F'`. Plugin sem `config` recebe `undefined`.
- **O schema é um `z.object`.** O campo `messages` é reservado.
- **`secret()` marca um segredo.** O valor some do log, aparece como `'********'` para o dashboard
  e só pode vir do ambiente ou do arquivo de config, nunca do storage.
- **`messages` são os textos do plugin.** O dono do bot pode trocá-los (para outro tom ou outro
  idioma) sem mexer no código. Use `ctx.plugin.messages` em vez de texto fixo no que a pessoa lê.

Config inválida não derruba o bot: o plugin fica fora, e a tabela de boot diz o campo e de onde
veio o valor.

## De onde vem o valor

O dono do bot define a config em três lugares. Para cada campo, vale o primeiro que tiver valor:

| Ordem | Onde | Exemplo para o `clima` |
| --- | --- | --- |
| 1 | Variável de ambiente | `ZAPFORGE_CLIMA__API_KEY=abc12345` |
| 2 | `pluginConfig` na config do app | `createBot({ pluginConfig: { clima: { cidade: 'Recife' } } })` |
| 3 | Override salvo pelo dashboard | `bot.config.setOverrides('clima', { unidade: 'F' })` |
| 4 | O `.default()` do schema | `'São Paulo'` |

O nome da variável é `ZAPFORGE_<PLUGIN>__<CAMPO>`, em maiúsculas com `_`: o plugin `user-names`
com o campo `openai.apiKey` vira `ZAPFORGE_USER_NAMES__OPENAI__API_KEY`. Os textos de `messages`
seguem a mesma regra: `ZAPFORGE_CLIMA__MESSAGES__SEM_DADOS`.

Documente no README do plugin os campos e a variável de cada segredo: é o que o dono do bot
precisa para configurá-lo.

## Mudança em runtime

Quando a config muda pelo dashboard, o kernel recarrega o plugin: roda o `teardown` e um `setup`
novo, com a config nova, sem reiniciar o bot. Por isso:

- monte no `setup` o que depende da config (um cliente de API com a chave, um timer com o
  intervalo), e não em escopo de módulo;
- libere no `teardown`, ou pelo `ctx.signal`, o que o `setup` abriu fora do contexto.

```ts
setup(ctx) {
  const api = criarClienteClima(ctx.config.apiKey); // recriado a cada reload
  const timer = setInterval(() => api.aquecerCache(), 60_000);
  ctx.signal.addEventListener('abort', () => clearInterval(timer));
}
```

Comandos, listeners, rotas e jobs registrados pelo contexto saem sozinhos no reload.

## Config do bot não é do plugin

Donos do bot (`owners`), prefixo e transport são da config do app, não do plugin. O plugin não lê
`process.env`: tudo o que ele precisa configurar entra pelo schema.

## Testar

O kit não lê o ambiente da máquina. Passe a config em `pluginConfig`, ou o ambiente em `env`:

```ts
const bot = await createTestBot({
  plugins: [clima],
  pluginConfig: { clima: { apiKey: 'chave-de-teste', unidade: 'F' } },
});
```

Um plugin com campo obrigatório sem valor fica fora do boot também no teste: confira em
`bot.bot.plugins()` o motivo. Mais em [Testes](testes.md).
