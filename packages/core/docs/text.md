# Texto formatado

O plugin escreve negrito, itálico, código, link e menção uma vez só, e cada transport traduz para
a marcação da plataforma ([ADR 0061](../../../docs/adr/0061-texto-formatado-neutro.md)).

```ts
import { bold, code, fmt, italic, link, mention } from '@zapforge/core';

await ctx.reply(fmt`Notas de ${bold(aluno.nome)}: ${code(nota.toFixed(1))}`);
await ctx.reply(fmt`Oi ${mention(ctx.message.sender)}, veja ${link('https://ex.com', 'o site')}`);
await ctx.reply.image(foto, { caption: italic('enviada agora') });
await ctx.send.send(chatId, fmt`Aviso para ${mention(contato)}`);
await ctx.send.edit(key, bold('atualizado'));
```

| Helper | WhatsApp | Discord | Telegram |
| --- | --- | --- | --- |
| `bold(...)` | `*a*` | `**a**` | negrito |
| `italic(...)` | `_a_` | `*a*` | itálico |
| `code(texto)` | `` `a` `` | `` `a` `` | código |
| `link(url, rótulo?)` | `rótulo (url)` | `[rótulo](url)` | link |
| `mention(contato)` | `@número` | `<@id>` | `text_mention` |

A coluna do WhatsApp é o `@zapforge/transport-baileys`. As outras mostram o que os transports
desses canais devem gerar.

## Regras

- **`fmt` compõe.** Um valor interpolado é literal: uma string com `*` do usuário não vira
  negrito, e o transport a escapa onde a plataforma tem escape (Telegram, Discord, web). Números
  viram texto. Os helpers também aceitam outros trechos: `bold('a ', italic('b'))`.
- **Texto cru continua valendo.** `ctx.reply('*cru*')` vai ao transport como veio, na marcação da
  plataforma. Serve ao plugin que só roda num canal.
- **A árvore é congelada.** Dá para guardá-la e reusá-la, mas não para alterá-la.
- **`link` só aceita `http:` e `https:`.** No web, a URL vira `href`, e `javascript:` seria XSS.
  Uma URL inválida lança `TypeError`.
- **`mention` guarda `id`, `name`, `phone` e `username`.** Os `claims` do contato não vão para o
  conteúdo. O transport notifica só quem está num `mention()` ou em `ReplyOptions.mentions`. A
  citação do `ctx.reply` não pinga o autor.
- **Trecho vazio some.** `bold('')` não gera marcação.

## Texto visível

`plainText(texto)` devolve o que a pessoa lê, sem marcação. Uma menção vira `@` mais o usuário,
o nome, o telefone ou o ID, nessa ordem.

```ts
plainText(fmt`Notas de ${bold('Maria')}`); // 'Notas de Maria'
```

É esse texto que vai em `content.text` junto da árvore. Por isso os matchers do kit casam o
texto visível: `expect(bot).toHaveReplied('Notas de Maria')`.

## Texto longo

O transport declara os limites da plataforma, e a fila de saída divide o texto acima deles em
várias mensagens ([Fila de saída](outbound-queue.md#texto-longo)). O plugin não precisa contar
caracteres. A chave devolvida é a da primeira parte.

O `edit` não divide: acima do limite, rejeita com `RangeError`.

## Na entrada

`message.text` é o texto que a pessoa escreveu, com as menções legíveis: no Discord, o transport
troca `<@123>` por `@nome`. Os mencionados ficam em `message.mentions`. A formatação da entrada
(as entities do Telegram, por exemplo) não entra na `Message`.
