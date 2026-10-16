# user-names

Apelidos e nome de exibição por `Contact.id` (opaco: serve a qualquer plataforma). Dados no
storage do próprio plugin (KV: `nick:<id>` e `seen:<id>`).

## Comandos

| Comando | O que faz |
| --- | --- |
| `!nick Nome` (alias `!apelido`) | Define o apelido de quem enviou |
| `!nick @pessoa Nome` | Define o apelido da pessoa mencionada (o trecho da menção sai do texto) |

Sem nome, ou `@algo` sem menção resolvida, responde o uso. Como no legacy, qualquer pessoa pode
dar apelido a qualquer outra (sem papel). O `!nick @pessoa` precisa da capability `mentions` do
transport; o plugin não a exige, então `!nick Nome` funciona sem ela.

## Enriquecimento

`remember` roda sozinho em: remetente e mencionados de toda mensagem (inclusive comandos, via
evento `command`), `group.participants` e `contact.updated`. Guarda o último nome e telefone
não vazios; só grava se mudou.

Lacuna do Bridger: não há API pública para resolver LID para telefone nem para listar os
participantes de um grupo sob demanda; só se aprende o que passa pelos eventos acima.

## `messages`

`nickUsage`, `nickSet`, `nickSetOther` (`{nick}`, `{who}`, `{prefix}`).

## Serviço `userNames` (contrato estável, ADR 0002)

```ts
displayName(id): Promise<string>  // fontes em ordem; senão telefone observado; senão id antes do '@' ('usuário' para LID)
setNick(id, nick): Promise<void>
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
