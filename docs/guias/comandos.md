# Comandos

Um comando é o que a pessoa digita com o prefixo do bot, como `!sorteio Ana Bia Caio`. Este
guia cobre o caso comum. O detalhe de cada regra está em
[Comandos no core](../../packages/core/docs/commands.md).

## O primeiro comando

Comando fixo vai direto no manifesto, em `commands`. O nome vem da chave:

```ts
import { definePlugin } from '@zapforge/core';

export const sorteio = definePlugin({
  name: 'sorteio',
  version: '0.1.0',
  engine: '<1.0.0',
  commands: {
    sorteio: {
      description: 'Sorteia um nome: !sorteio Ana Bia Caio',
      aliases: ['sortear'],
      run: (c) => {
        if (c.args.length === 0) return 'Diga os nomes: !sorteio Ana Bia Caio';
        const nome = c.args[Math.floor(Math.random() * c.args.length)];
        return `Sorteado: ${nome}`;
      },
    },
  },
});
```

- **Devolver texto responde.** O `run` que devolve uma string (ou um texto de `fmt`) responde
  citando a mensagem. Qualquer outro valor não responde nada.
- **Caixa não importa.** `!Sorteio` e `!SORTEIO` rodam o mesmo comando; os argumentos mantêm a
  caixa.
- **Nome e alias são únicos no bot inteiro.** Dois plugins com o mesmo nome derrubam o boot com
  `CommandConflictError`, citando os dois.
- **O prefixo é do bot**, não do plugin: `!` por padrão, e o app ou outro plugin pode trocá-lo por
  chat. Para mostrar o prefixo certo numa mensagem, use `ctx.prefixes.get(c.message.chat)`.

## Argumentos

| Campo | O que traz | Em `!sorteio "Ana Clara" Bia` |
| --- | --- | --- |
| `c.args` | Os argumentos já quebrados; aspas duplas agrupam | `['Ana Clara', 'Bia']` |
| `c.rawArgs` | O texto depois do comando, como veio | `'"Ana Clara" Bia'` |
| `c.invokedAs` | O que a pessoa digitou (nome ou alias), em minúsculas | `'sorteio'` |

Para subcomandos, desestruture: `const [sub, ...resto] = c.args`. Para um texto livre, como uma
pergunta a uma IA, use `c.rawArgs`.

## Responder

`c.reply` responde citando a mensagem e devolve a chave da mensagem enviada. Ele tem um método por
tipo de conteúdo:

```ts
await c.reply('texto');
await c.reply.image(buffer, { caption: 'legenda' });
await c.reply.document(pdf, { fileName: 'notas.pdf', mimetype: 'application/pdf' });
await c.reply.poll('Almoço?', ['Pizza', 'Sushi'], { multiple: true });
await c.react('👍'); // reage à mensagem do comando
```

Mídia, enquete e reação dependem do transport: veja [Capabilities](capabilities.md). Para
negrito, link e menção que funcionam em toda plataforma, use `fmt` (veja
[Portabilidade](portabilidade.md#formatação)).

Para enviar a outro chat, use o `send` do contexto do plugin, o 2º argumento do `run`:

```ts
run: async (c, { send }) => {
  await send.send('id-do-chat-de-avisos', `Novo aviso de ${c.message.sender.name}`);
  return 'Aviso enviado.';
},
```

## Quem pode rodar: `role`

```ts
commands: {
  limpar: { role: 'group-admin', run: (c) => /* ... */ 'Limpo.' },
  desligar: { role: 'owner', run: () => /* ... */ 'Até mais.' },
},
```

| `role` | Quem roda |
| --- | --- |
| `everyone` (padrão) | Todo mundo |
| `owner` | Os donos do bot, em `owners` da config do app |
| `group-admin` | Admins do grupo, e os owners. Fora de grupo, recusa |

Na dúvida, a regra recusa: sem como saber quem é admin, `group-admin` só deixa os owners passarem.
Um plugin pode criar um papel próprio (`moderador`) com `ctx.roles.define` no `setup`, e qualquer
plugin o exige pelo nome ([Papéis custom](../../packages/core/docs/commands.md#papéis-custom)).

## Exigir mídia: `accepts`

`accepts` lista os tipos de mensagem que o comando aceita, da própria mensagem ou da citada
(`quoted:`). A primeira entrada que casa resolve `c.media`:

```ts
commands: {
  tamanho: {
    accepts: ['image', 'quoted:image'],
    onReject: () => 'Mande ou responda uma imagem.',
    run: async (c) => {
      const bytes = await c.media!.download();
      return `${bytes.length} bytes`;
    },
  },
},
```

Se o papel ou o `accepts` não fecham, o comando é recusado: o `onReject` responde, e sem ele a
recusa é silenciosa. O `!` em `c.media!` é seguro aqui porque o `accepts` só tem tipos com mídia.

## Comando que demora

Cada comando tem 30 segundos (o `commandMs` do bot). Repasse o `c.signal` a `fetch` e SDKs para o
trabalho parar no prazo:

```ts
commands: {
  baixar: {
    timeoutMs: 300_000, // só este comando ganha 5 minutos
    run: async (c) => {
      const res = await fetch(c.rawArgs, { signal: c.signal });
      await c.reply.document(Buffer.from(await res.arrayBuffer()), {
        fileName: 'arquivo',
        mimetype: res.headers.get('content-type') ?? 'application/octet-stream',
      });
    },
  },
},
```

Enquanto roda, o comando segura o chat: a próxima mensagem daquele chat espera. Para não segurar,
responda "baixando…" e solte o trabalho, como em
[trabalho longo](eventos-e-midia.md#trabalho-longo).

## Perguntar e esperar a resposta

O `run` não espera a próxima mensagem: ela está na fila atrás dele. Ele pergunta, registra o passo
que trata a resposta e termina:

```ts
setup(ctx) {
  ctx.commands.add(
    command({
      name: 'cadastro',
      run: async (c) => {
        await c.reply('Qual o seu nome?');
        c.expectReply('nome');
      },
    }),
  );
  ctx.conversations.define('nome', (c) => c.reply(`Prazer, ${c.text}!`));
}
```

Os passos se registram no `setup`, por isso este comando usa a forma longa
(`ctx.commands.add(command({...}))`, com `command` importado de `@zapforge/core`). Encadear passos,
validade e cancelamento estão em [Conversas](../../packages/core/docs/conversations.md).

## Botões

A resposta pode levar botões. O clique roda um comando, com os argumentos que o botão define:

```ts
run: (c) =>
  c.reply('O que você quer ver?', {
    actions: [
      { label: 'Notas', command: 'notas' },
      { label: 'Faltas', command: 'faltas', args: ['2026'] },
    ],
  }),
```

Onde a plataforma não tem botão, o kernel manda o menu em texto numerado e trata o "1" ou "2"
como o clique ([Portabilidade](portabilidade.md#botões)).

## Forma curta ou `setup`

A forma curta cobre comando fixo. Use `ctx.commands.add` no `setup` quando o comando depende da
config, usa passos de conversa ou papéis custom. Os dois caminhos registram do mesmo jeito: prazo,
recusa e reload são iguais. Mais em
[Plugins → Forma curta](../../packages/core/docs/plugins.md#forma-curta-commands-e-on).

## Testar

```ts
import { createTestBot } from '@zapforge/testing';
import { expect, it } from 'vitest';
import { sorteio } from './index.ts';

it('sorteia um dos nomes', async () => {
  const bot = await createTestBot({ plugins: [sorteio] });
  await bot.receive({ text: '!sorteio Ana' });
  expect(bot.sent).toHaveReplied('Sorteado: Ana');
  await bot.stop();
});
```

Mais em [Testes](testes.md).
