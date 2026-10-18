# Plugin `help`

Menu de comandos gerado de `ctx.commands.list()`: comando novo aparece sozinho. Código em
`src/plugins/help/`: `help.ts` (plugin e serviço) e `format.ts` (formatação pura).

## Comandos

| Comando | Saída |
| --- | --- |
| `!help` / `!menu` / `!ajuda` | Comandos em blocos (`• *!nome* (!alias) - descrição`), com o prefixo do chat, e depois as seções do ponto `help.sections` |

Só entram comandos com `description` e papel `everyone`, ou `group-admin` quando o chat é um grupo. O kernel não entrega o
remetente ao serviço, então `owner` e papéis custom ficam sempre de fora, mesmo para quem os pode
rodar.

Os blocos e a ordem deles ficam em `GROUPS` (`help.ts`): 🎨 Mídia, 🧠 Inteligência artificial, 🏆 Social e 🛠️ Utilitários,
cada um com os nomes dos plugins que agrupa. Plugin fora da lista cai em 📦 Outros, no fim. Dentro
do bloco, a ordem é a de registro. Plugin novo com comando: inclua o nome dele em `GROUPS`.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `list_commands` | — | Devolve o menu do chat (`menu`), o mesmo do `!help`, sem enviá-lo | — |

## Textos

`messages.title` (`BRIDGER_HELP__MESSAGES__TITLE`), o cabeçalho do menu. O título de cada bloco vem
de `GROUPS`.

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
