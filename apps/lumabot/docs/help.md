# Plugin `help`

Menu de comandos gerado de `ctx.commands.list()`: comando novo aparece sozinho. Código em
`src/plugins/help/`: `help.ts` (plugin e serviço) e `format.ts` (formatação pura).

## Comandos

| Comando | Saída |
| --- | --- |
| `!help` / `!menu` / `!ajuda` | Comandos agrupados pelo nome do plugin (`!nome, !alias: descrição`), com o prefixo do chat, e depois as seções do ponto `help.sections` |

Só entram comandos com `description` e papel `everyone`, ou `group-admin` quando o chat é um grupo. O kernel não entrega o
remetente ao serviço, então `owner` e papéis custom ficam sempre de fora, mesmo para quem os pode
rodar.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `list_commands` | — | Devolve o menu do chat (`menu`), o mesmo do `!help`, sem enviá-lo | — |

## Textos

`messages.title` (`BRIDGER_HELP__MESSAGES__TITLE`), o cabeçalho do menu. O título de cada grupo é
o nome do plugin.

## Serviço `help`

```ts
interface HelpService {
  render(chat: Pick<Chat, 'id' | 'isGroup'>): string;
}
```

## Ponto de extensão `help.sections`

```ts
type HelpSection = (input: { chat; prefix: string }) =>
  { title: string; lines: readonly string[] } | null;
```

Para o que não é comando. Seções vêm depois dos comandos, na ordem de carga; `null` omite a seção, e uma seção que lança é omitida com um `warn` no log, sem derrubar o menu.
O plugin que estende declara `dependsOn: { help: '^1.0.0' }`:

```ts
setup(ctx) {
  ctx.services.contribute('help.sections', ({ prefix }) => ({
    title: 'Fale com a Luma',
    lines: [`Mencione a Luma, sem ${prefix}`],
  }));
}
```
