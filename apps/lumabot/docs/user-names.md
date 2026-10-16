# user-names

Apelidos e nome de exibição por `Contact.id` (opaco: serve a qualquer plataforma). Dados no
storage do próprio plugin (KV: `nick:<id>` e `seen:<id>`).

## Comandos

| Comando | O que faz |
| --- | --- |
| `!nick Nome` (alias `!apelido`) | Define o apelido de quem enviou |
| `!nick @pessoa Nome` | Define o apelido da pessoa mencionada (o trecho da menção sai do texto) |

Sem nome, vazio após a limpeza, ou `@algo` sem menção resolvida (`!nick Fulano @alguem`), responde o uso e não grava; acima de 32 caracteres, `nickTooLong`. A resposta de `!nick @pessoa` não menciona a pessoa no chat (o legacy mencionava). Como no legacy, qualquer pessoa pode
dar apelido a qualquer outra (sem papel). O `!nick @pessoa` precisa da capability `mentions` do
transport; o plugin não a exige, então `!nick Nome` funciona sem ela.

## Enriquecimento

`remember` roda sozinho em: remetente e mencionados de toda mensagem (inclusive comandos, via
evento `command`), `group.participants` e `contact.updated`. Guarda o último nome e telefone
não vazios; só grava se mudou.

Não enriquece por `groups.metadata` (o legacy também não). A resposta a um passo de conversa
(`expectReply`) não passa por `message` nem por `command`, então também não enriquece.

Nomes (apelido e pushName) passam por limpeza: NFC, sem caracteres de controle/formatação
(bidi, largura zero), espaços colapsados. Apelido acima de 32 caracteres é recusado; o pushName
é só cortado em 32.

## `messages`

`nickUsage`, `nickTooLong`, `nickSet`, `nickSetOther` (`{nick}`, `{who}`, `{prefix}`).

## Serviço `userNames` (contrato estável, ADR 0002)

```ts
displayName(id): Promise<string>  // fontes em ordem; senão '@' + 6 últimos dígitos do telefone observado ou do id (como o legacy)
setNick(id, nick): Promise<void>  // limpa; lança NickEmptyError (vazio) ou NickTooLongError (> 32)
nick(id): Promise<string | null>
remember(contact: { id; name; phone }): Promise<void>
```

Uso opcional (ex.: `rank`): `ctx.services.has('userNames')` na hora do uso, sem `dependsOn`.

## Ponto de extensão `userNames.sources`

`NameSource = (id: string) => Promise<string | null>`. A primeira fonte que devolve nome vence;
`null` passa à próxima; fonte que lança é logada e ignorada. O plugin contribui, nesta ordem:
apelido e nome observado. Quem carrega depois vem depois.

```ts
definePlugin({
  name: 'crm',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { 'user-names': '^1.0.0' },
  setup: (ctx) => {
    ctx.services.contribute('userNames.sources', async (id) => clientes.get(id) ?? null);
  },
});
```
