# resumo

Resumo da conversa do chat: `!resumo [n]` e a tool `summarize_chat`. Código em
`src/plugins/resumo/resumo.ts`.

## Como funciona

Guarda **em memória** as últimas `bufferSize` mensagens de texto de cada chat que não foram comando
(o nome vem do `user-names`, se existe). `!resumo` pede à IA ([`ai`](ai.md), `purpose: 'resumo'`) um
resumo descontraído, em até 5 linhas, no tom da Luma. Um restart recomeça a janela.

| Comando | O que faz |
| --- | --- |
| `!resumo` | Resume as últimas `defaultLimit` (50) mensagens |
| `!resumo <n>` | Resume as últimas `n`, até `maxLimit` (200). `n` que não é número ou é menor que 1 cai no padrão |

Roda em segundo plano (não segura o chat), com prazo de 90 s. Sem conversa guardada, responde que
não há; falha da IA responde uma frase curta e vai para o log. O plugin depende do `ai`.

## Tool da IA

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `summarize_chat` | `limit?` | Devolve o resumo (`summary`) só ao modelo | `no-history`, `empty` |

## Serviço `resumo`

```ts
summarize(chatId, limit?, signal?): Promise<string | null>  // null: ainda não viu conversa ali
```

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `bufferSize` | `200` | Mensagens guardadas por chat |
| `defaultLimit` / `maxLimit` | `50` / `200` | Padrão e teto do `!resumo` (`defaultLimit` não passa de `maxLimit`) |
| `models` | `[]` | Cadeia só do resumo, no formato do `ai`. Vazio usa a principal |

`messages`: `summary` (`{text}`), `empty`, `failed`.
