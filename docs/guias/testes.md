# Testes

O [`@zapforge/testing`](../../packages/testing/docs/README.md) sobe um bot de verdade (plugins,
filas, roteador, storage em memória) sobre um transport falso, sem rede. O teste manda mensagens e
confere o que o bot enviou. O kit funciona com o [Vitest](https://vitest.dev).

```sh
npm install -D @zapforge/testing vitest
```

O projeto criado pelo `create-zapforge-plugin` já vem com o kit e um teste pronto.

## O primeiro teste

```ts
import { createTestBot } from '@zapforge/testing';
import { expect, it } from 'vitest';
import { meuPlugin } from './index.ts';

it('responde ao !ping', async () => {
  const bot = await createTestBot({ plugins: [meuPlugin] });

  await bot.receive({ text: '!ping' });

  expect(bot.sent).toHaveReplied('pong');
  await bot.stop();
});
```

- **`receive()` espera o bot terminar.** Quando ele resolve, o que a mensagem causou já está em
  `bot.sent`, inclusive o que o plugin enviou sem `await`. Não use `sleep`.
- **Chame `bot.stop()`** no fim de cada teste: ele roda o `teardown` dos plugins.
- **Cada bot é isolado:** storage em memória novo, nada do ambiente da máquina na config, envios
  sem espera entre mensagens.

## Mensagens de entrada

O `receive()` recebe só o que importa para o teste; o resto vem com padrões:

```ts
import { fixtures } from '@zapforge/testing';

await bot.receive({ text: 'oi' });
await bot.receive({ text: '!s', image: fixtures.image() });           // imagem com legenda
await bot.receive({ text: '!s', quoted: { image: fixtures.image() } }); // respondendo uma imagem
await bot.receive({ text: 'oi', chat: { id: 'grupo@fake', isGroup: true } });
await bot.receive({ text: '!quem', sender: { name: 'Ana' } });
```

`fixtures` tem uma mídia válida e pequena de cada tipo (`image`, `video`, `audio`, `voice`,
`sticker`, `document`), para plugins que decodificam o arquivo.

## Conferir o que saiu

| Matcher | Passa quando |
| --- | --- |
| `toContainText(texto?)` | Algum envio é texto; com `texto`, igual à string ou casando com a RegExp |
| `toHaveReplied(texto?)` | Algum envio cita uma mensagem, como o `reply` faz |
| `toContainImage()` | Algum envio é imagem |
| `toContainSticker()` | Algum envio é figurinha |

Os matchers comparam o texto visível: um `fmt` com negrito casa com o texto sem marcação. Para
outros detalhes, leia os registros: `bot.sent[0]?.content`, `bot.transport.reactions`,
`bot.transport.edits`.

## Donos, grupos e eventos

```ts
import { DEFAULT_SENDER } from '@zapforge/testing';

// O remetente padrão como dono do bot
const bot = await createTestBot({ plugins: [admin], owners: [DEFAULT_SENDER.phone!] });

// Outro evento do transport
await bot.emit('reaction', {
  chat: { id: 'chat@fake', isGroup: false },
  messageId: 'in-1',
  sender: DEFAULT_SENDER,
  emoji: '👍',
  fromMe: false,
});
```

Para `role: 'group-admin'` e `ctx.groups.metadata`, registre o grupo no transport com
`bot.transport.setGroup({ id, title, description, ownerId, participants })`.

## Config

O kit não lê as variáveis `ZAPFORGE_*` da máquina. Passe a config do plugin em `pluginConfig`:

```ts
const bot = await createTestBot({
  plugins: [clima],
  pluginConfig: { clima: { apiKey: 'chave-de-teste' } },
});
```

## Plugin que não subiu

Um plugin com config inválida ou capability faltando fica fora do boot, sem erro no
`createTestBot`. Se nada responde, confira a tabela de boot:

```ts
expect(bot.bot.plugins()).toContainEqual(expect.objectContaining({ name: 'clima', status: 'loaded' }));
```

## Botões

O `click()` clica num botão pelo rótulo:

```ts
await bot.receive({ text: '!menu' });
await bot.click(bot.sent[0]!, 'Notas');
expect(bot.sent).toContainText(/notas/i);
```

Para ver o menu numerado da plataforma sem botão, use o perfil `whatsapp` e responda com o número:
`await bot.receive({ text: '1' })`.

## Perfis de plataforma

Sem perfil, o transport falso tem todas as capabilities, e um plugin que só funciona no WhatsApp
passa. Com `profile`, ele declara o que a plataforma declara, e o remetente tem o formato dela
(sem telefone fora do WhatsApp):

```ts
const bot = await createTestBot({ profile: 'telegram', plugins: [meuPlugin] });
```

Os perfis são `whatsapp`, `telegram`, `discord` e `web`. A lista de cada um está em
[Capabilities](capabilities.md#matriz-por-transport).

### O mesmo teste em todas as plataformas

```ts
import { createTestBot, PROFILE_NAMES } from '@zapforge/testing';
import { describe, expect, it } from 'vitest';

describe.each(PROFILE_NAMES)('no %s', (profile) => {
  it('responde ao !ping', async () => {
    const bot = await createTestBot({ profile, plugins: [meuPlugin] });
    await bot.receive({ text: '!ping' });
    expect(bot.sent).toContainText('pong');
    await bot.stop();
  });
});
```

Prefira `toContainText` a `toHaveReplied` nessa matriz: num perfil sem `quoted`, a resposta sai
sem citar. Num perfil sem telefone, um dono por telefone não reconhece o remetente; use
`owners: [{ id: DEFAULT_SENDER.id }]`.

## Limites

- **Jobs do scheduler** não entram na espera do `receive()`. Teste o agendamento pela resposta e a
  lógica do job como função à parte.
- **O nome do transport falso é `fake`.** Um plugin com `transports: ['discord']` fica fora do boot
  no kit; teste uma cópia sem `transports` ([Escape hatch](escape-hatch.md#testar)).
- **Conversas** (resposta esperada) se testam como uma sequência de `receive()`: a pergunta, depois
  a resposta.

O resto do kit (`FakeTransport` à mão, anexos, chat de thread, claims e tenant) está na
[documentação do `@zapforge/testing`](../../packages/testing/docs/README.md).
