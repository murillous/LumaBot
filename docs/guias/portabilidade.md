# Portabilidade entre plataformas

O mesmo plugin pode rodar no WhatsApp, no Telegram, no Discord e num chat web. Ele só precisa
evitar o que é de uma plataforma: marcação na mão, ID que parece telefone, botão que não existe
em todo lugar. Este guia junta essas regras. O exemplo do
[`create-zapforge-plugin`](../../packages/create-plugin/docs/README.md) já nasce portátil.

## Capabilities: exija pouco, confira o resto

Declare em `requires` só o que o plugin não funciona sem, e confira o resto em
`ctx.capabilities`. Cada capability a mais em `requires` tira o plugin de uma plataforma: o chat
web, por exemplo, não tem reação, figurinha nem grupo. A matriz por plataforma está em
[Capabilities](capabilities.md#matriz-por-transport).

```ts
run: async (c, { capabilities }) => {
  if (capabilities.has('reactions')) await c.react('✅');
  return 'Feito.';
},
```

## Formatação

Cada plataforma marca negrito de um jeito: `*a*` no WhatsApp, `**a**` no Discord, HTML no
Telegram. Escreva com os helpers do core, e o transport traduz:

```ts
import { bold, code, fmt, link, mention } from '@zapforge/core';

return fmt`Notas de ${bold(aluno.nome)}: ${code(nota.toFixed(1))}`;
await c.reply(fmt`Oi ${mention(c.message.sender)}, veja ${link('https://exemplo.com', 'o site')}`);
```

- O valor interpolado no `fmt` é literal: um `*` digitado pelo usuário não vira negrito.
- Texto cru (`'*negrito*'`) vai como veio. Serve ao plugin que só roda numa plataforma.
- Não conte caracteres: a fila de saída divide o texto acima do limite da plataforma.

Mais em [Texto formatado](../../packages/core/docs/text.md).

## IDs, telefone e donos

O `id` de um contato ou chat é o identificador da plataforma, opaco para o plugin: não decomponha
nem tire o telefone dele.

- **`sender.phone` pode ser `null`.** Discord, Telegram e web não informam telefone. Use o
  telefone só como dado extra, nunca como chave.
- **`sender.name` pode ser `null`.** Tenha um texto para o caso: `sender.name ?? 'pessoa'`.
- **Guarde dados pelo `id`**, e não pelo telefone. Num storage comum a vários bots
  (`ctx.storage.shared`), componha com `ctx.transportName`: o `42` do Telegram não é o `42` do
  Discord ([Storage](storage.md#dados-comuns-a-vários-bots)).
- **Donos do bot** (`owners` na config do app) são telefone onde a plataforma tem telefone e
  `{ id: '...' }` onde não tem. O plugin não lê a lista: exige `role: 'owner'` no comando, e o
  kernel compara do jeito certo.
- **Contas automatizadas** vêm com `sender.isBot: true`, e o bot as ignora por padrão. Isso evita
  loop entre dois bots num canal do Discord.

## Tipos de chat

`chat.isGroup` vale para todo chat que não é conversa privada. Quando a plataforma informa,
`chat.kind` diz o tipo: `dm`, `group`, `channel` (canal do Discord ou do Telegram) ou `thread`
(tópico ou thread). O `reply` responde dentro da thread; não é preciso tratar nada.

```ts
if (!c.message.chat.isGroup) return 'Este comando só funciona em grupo.';
if (c.message.chat.kind === 'thread') c.log.info('comando dentro de uma thread');
```

## Botões

Use `actions` no `reply`. Onde a plataforma tem botão (Telegram, Discord, web), eles aparecem.
Onde não tem (WhatsApp), ou quando há mais botões do que cabem, o kernel manda um menu numerado
e trata o "1", o "2" como o clique:

```ts
run: (c) =>
  c.reply('Escolha:', {
    actions: [
      { label: 'Notas', command: 'notas' },
      { label: 'Faltas', command: 'faltas' },
    ],
  }),
```

```
Escolha:

1. Notas
2. Faltas
```

O plugin não precisa saber qual dos dois aconteceu. Não escreva o menu numerado na mão: nas
plataformas com botão ele sobraria. Mais em [Ações e botões](../../packages/core/docs/actions.md).

## Resposta esperada

Para perguntar algo e tratar a resposta, use `c.expectReply(passo)` e `ctx.conversations.define`.
Funciona igual em toda plataforma, inclusive com o menu numerado, que usa o mesmo mecanismo:

```ts
setup(ctx) {
  ctx.commands.add(
    command({
      name: 'notas',
      run: async (c) => {
        await c.reply('De qual aluno?');
        c.expectReply('aluno');
      },
    }),
  );
  ctx.conversations.define('aluno', (c) => c.reply(`Buscando as notas de ${c.text}…`));
}
```

Não espere a próxima mensagem dentro do `run` (com uma promise que um listener resolve): ela está
na fila atrás do comando, e o chat trava até o prazo. Mais em
[Conversas](../../packages/core/docs/conversations.md).

## Tenant

Um bot pode atender vários clientes do dono (escolas, empresas): o transport web marca o
`chat.tenantId` com o que verificou no login. O plugin não precisa fazer nada para separar os
dados:

- o `ctx.storage` de uma mensagem de um tenant lê e grava só os dados dele;
- o service chamado e o job agendado nessa mensagem seguem no mesmo tenant;
- o `setup` e os jobs agendados nele não têm tenant: o storage ali é o comum a todos.

O que quebra o isolamento é estado em memória: um `Map` no plugin é um só para todos os tenants.
Guarde no `ctx.storage` o que é de um cliente. Para ler outro tenant de propósito (um comando de
administração), use `ctx.storage.forTenant(id)`
([Storage → Tenants](storage.md#tenants-um-bot-vários-clientes)).

Os `claims` do remetente (`sender.claims`) trazem o que o transport verificou, como o papel do
usuário no sistema de origem. Pode confiar neles; não confie em texto que o usuário digitou.

## O que não é portátil

Quando o plugin precisa de algo que só uma plataforma tem, ele declara `transports` no manifesto e
usa o [escape hatch](escape-hatch.md). Fica preso àquela plataforma, e o loader o recusa nas
outras.

## Testar em todas as plataformas

O kit tem um perfil por plataforma, com as capabilities, os limites e o formato de contato de
cada uma. Rode o mesmo teste em todos:

```ts
import { createTestBot, PROFILE_NAMES } from '@zapforge/testing';
import { describe, expect, it } from 'vitest';

describe.each(PROFILE_NAMES)('no %s', (profile) => {
  it('responde ao !ok', async () => {
    const bot = await createTestBot({ profile, plugins: [meuPlugin] });
    await bot.receive({ text: '!ok' });
    expect(bot.sent).toContainText('Feito.');
    await bot.stop();
  });
});
```

Um plugin que só passa no WhatsApp falha aqui: no perfil `web`, por exemplo, o remetente não tem
telefone e não há reação. Mais em [Testes](testes.md#o-mesmo-teste-em-todas-as-plataformas).
