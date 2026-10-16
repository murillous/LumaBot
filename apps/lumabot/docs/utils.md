# utils

Dois comandos pequenos. O plugin **não oferece serviço**: não há regra a reutilizar além do
ponto de extensão `utils.info` ([ADR 0002](../../../docs/adr/0002-plugins-abertos-para-extensao.md)).

## Comandos

| Comando | O que faz |
| --- | --- |
| `!meunumero` (alias `!meuid`) | Responde com o cabeçalho (`header`) e uma linha por contribuição de `utils.info`. As padrão: seu número (`sender.phone`, ou o `sender.id` onde não há telefone) e o ID do chat |
| `!prefixo X` | Só admin de grupo. Troca o prefixo do chat por `X` (vale para o bot inteiro, fica no storage) |
| `!prefixo` | Só admin de grupo. Volta ao prefixo padrão |

Prefixo válido: um único argumento de 1 a 5 caracteres, sem espaço (`!prefixo ""`, várias palavras ou texto longo são recusados e o prefixo atual fica). O kernel grava em minúsculo, e a resposta mostra o que ficou valendo. Quem não é admin, ou usa em DM, recebe `prefixDenied`.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `chat_info` | — | Devolve as linhas do `!meunumero` (`lines`), com as de `utils.info` | — |

## Config

Sem opções. Os textos são `messages` (`header`, `senderLine`, `chatLine`, `prefixSet`, `prefixReset`,
`prefixInvalid`, `prefixDenied`); `{value}` leva o número/ID, o ID do chat ou o prefixo.

## Ponto de extensão `utils.info`

```ts
type InfoLine = (input: { chat: Chat; sender: Contact }) => Promise<string | null> | string | null;
```

Cada contribuição vira uma linha do `!meunumero`, na ordem de carga. `null` omite a linha;
contribuição que lança é logada e omitida, sem derrubar o comando.

```ts
definePlugin({
  name: 'user-names',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { utils: '^1.0.0' },
  setup: (ctx) => ctx.services.contribute('utils.info', ({ sender }) => `🏷️ Apelido: ${sender.name}`),
});
```
