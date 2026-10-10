# Seu primeiro plugin em 5 minutos

Você vai criar um plugin, entender o código gerado, mudar um comando com teste e conversar com o
plugin rodando num bot de verdade, tudo no seu computador, sem conta em nenhuma plataforma.

Precisa do Node 24 ou mais novo (`node --version`).

## 1. Criar o projeto

```sh
npm create zapforge-plugin@latest zapforge-plugin-ola
cd zapforge-plugin-ola
npm install
```

O nome do pacote vira o nome do plugin sem o prefixo `zapforge-plugin-`: aqui, `ola`. O scaffold
aceita escopo (`@acme/zapforge-plugin-ola`) e recusa nome inválido antes de criar qualquer
arquivo ([detalhes](../../packages/create-plugin/docs/README.md)).

```
src/index.ts        # o plugin
src/index.test.ts   # o teste
package.json        # scripts test, typecheck, build e changeset
```

## 2. Ler o plugin

`src/index.ts` vem assim:

```ts
import { bold, definePlugin, fmt, type PluginDefinition } from '@zapforge/core';

export const ola: PluginDefinition = definePlugin({
  name: 'ola',
  version: '0.1.0',
  engine: '<1.0.0',
  commands: {
    ola: {
      description: 'Cumprimenta quem chamou',
      run: async (c, { capabilities }) => {
        if (capabilities.has('reactions')) await c.react('👋');
        return fmt`Olá, ${bold(c.message.sender.name ?? 'pessoa')}!`;
      },
    },
  },
});
```

- **`definePlugin`** valida o manifesto na hora. `name` identifica o plugin no bot, e `engine` é
  a faixa de versão do `@zapforge/core` com que ele roda.
- **`commands`** declara os comandos direto no manifesto: a chave `ola` vira `!ola`.
- **O `run` recebe a mensagem (`c`) e o contexto do plugin.** Devolver texto responde citando a
  mensagem.
- **A reação é opcional.** `capabilities.has('reactions')` confere se a plataforma tem reação. O
  plugin funciona também onde ela não existe.
- **`fmt` e `bold`** viram o negrito de cada plataforma. `*negrito*` escrito à mão só funciona no
  WhatsApp.

## 3. Rodar o teste

```sh
npm test
```

O teste usa o `@zapforge/testing`: sobe um bot de verdade sobre um transport falso, sem rede, e
roda o mesmo caso nos perfis de WhatsApp, Telegram, Discord e web.

```ts
describe.each(PROFILE_NAMES)('no %s', (profile) => {
  it('!ola cumprimenta quem chamou pelo nome', async () => {
    const bot = await createTestBot({ profile, plugins: [ola] });

    await bot.receive({ text: '!ola', sender: { name: 'Ana' } });

    expect(bot.sent).toContainText('Olá, Ana!');
    await bot.stop();
  });
  // ...
});
```

`bot.receive()` só resolve depois que o bot terminou de processar a mensagem, então o que ela
causou já está em `bot.sent`.

## 4. Criar um comando

Acrescente `eco` em `commands`, em `src/index.ts`:

```ts
  commands: {
    ola: { /* ... */ },
    eco: {
      description: 'Repete o que vier depois do comando',
      run: (c) => c.rawArgs || 'Mande algo depois do !eco.',
    },
  },
```

`c.rawArgs` é o texto depois do comando (`!eco bom dia` → `bom dia`). Para os argumentos já
separados, use `c.args`.

E um teste para ele, dentro do `describe.each` de `src/index.test.ts`:

```ts
  it('!eco repete o texto', async () => {
    const bot = await createTestBot({ profile, plugins: [ola] });

    await bot.receive({ text: '!eco bom dia' });

    expect(bot.sent).toContainText('bom dia');
    await bot.stop();
  });
```

Rode `npm test` de novo: o caso novo passa nos quatro perfis. Troque `'bom dia'` por outro texto
no `expect` para ver o teste falhar.

## 5. Conversar com o plugin num bot

O teste prova o comportamento. Para ver o plugin respondendo, suba um bot com o transport web, o
chat que vive dentro de um sistema web, e converse com ele pelo terminal. Tudo roda local.

```sh
npm install -D @zapforge/transport-web jose
```

Crie `bot.ts` na raiz do projeto:

```ts
import { createInterface } from 'node:readline/promises';
import { createBot, createHttp } from '@zapforge/core';
import { web } from '@zapforge/transport-web';
import { connectWebChat } from '@zapforge/transport-web/client';
import { SignJWT } from 'jose';
import { ola } from './src/index.ts';

// Só para desenvolver: num sistema de verdade, o segredo vem do ambiente e o token, do seu login.
const secret = 'segredo-de-desenvolvimento-com-32-bytes-ou-mais';

const http = createHttp({ port: 3000 });
const bot = createBot({
  transport: web({ auth: { secret } }),
  http,
  plugins: [ola],
  logLevel: 'warn',
});
await bot.start();

const token = await new SignJWT({ name: 'Ana' })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject('ana')
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(secret));
const chat = await connectWebChat({ url: 'ws://localhost:3000/transports/web/chat', token });
chat.on('message', (m) => console.log(`bot: ${m.text}`));

console.log('Converse com o bot (Ctrl+C para sair).');
const terminal = createInterface({ input: process.stdin, output: process.stdout });
terminal.on('SIGINT', () => terminal.close());
terminal.on('line', (linha) => void chat.send(linha));
terminal.on('close', () => {
  chat.close();
  void bot.stop();
});
```

O arquivo junta as duas pontas. O bot (`createBot`) recebe o plugin e o transport, e o transport
web publica o chat no servidor HTTP (`createHttp`). O cliente (`connectWebChat`) é o que um widget
faria no navegador: entra com um token assinado pelo seu sistema (aqui, pelo `jose`) e troca
mensagens.

```sh
node bot.ts
```

```
Converse com o bot (Ctrl+C para sair).
!ola
bot: Olá, Ana!
!eco bom dia
bot: bom dia
```

O Node 24 roda o `.ts` direto. O aviso `sem storage configurado` no início é esperado: sem um
storage, os dados do bot ficam em memória.

**No WhatsApp**, o mesmo plugin entra num bot com o `@zapforge/transport-baileys`, que pareia o
número por QR code ([transport-baileys](../../packages/transport-baileys/docs/README.md)). O
código do plugin não muda.

## Próximos passos

- [Comandos](comandos.md): argumentos, aliases, papéis e respostas.
- [Eventos e mídia](eventos-e-midia.md): reagir ao que acontece no chat e lidar com arquivos.
- [Storage](storage.md) e [Config](config.md): guardar dados e deixar o plugin configurável.
- [Capabilities](capabilities.md) e [Portabilidade entre plataformas](portabilidade.md): o que
  cada plataforma suporta e como escrever um plugin que roda em todas.
- [Testes](testes.md): o kit de testes a fundo.
- Para publicar no npm, o `README.md` gerado explica versão e changelog com `npm run changeset`.

Os outros guias estão no [índice](README.md).
