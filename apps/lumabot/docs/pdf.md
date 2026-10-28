# Plugin `pdf`

Imagem → PDF e junção de PDFs. Código em `src/plugins/pdf/`: `pdf.ts` (comandos) e `convert.ts`
(pdf-lib e Sharp).

## Comandos

A mídia vem da própria mensagem ou da citada. O `!mergepdf` aceita só documento
`application/pdf`; outra mídia recebe o texto de uso.

| Comando | Entrada | Saída |
| --- | --- | --- |
| `!pdf [nome]` | Imagem | PDF de uma página, com `nome` em slug (`Relatório Março` → `relatorio-marco.pdf`); padrão `imagem.pdf` |
| `!mergepdf` / `!joinpdf` | PDF | Adiciona o PDF à lista de quem mandou, naquele chat |
| `!mergepdf done [nome]` | — | Junta a lista na ordem e envia; padrão `pdf-juntado.pdf`. Também `pronto`, `finalizar` |
| `!mergepdf clear` | — | Esvazia a lista. Também `limpar`, `cancelar` |

Enquanto converte, o bot reage ⏳ e depois ✅ ou ❌; num transport sem `reactions`, a reação é
ignorada. Erro vai para o log (`falha ao processar mídia`) e o chat recebe `conversionError`.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `image_to_pdf` | `fileName?` | Imagem da mensagem ou da citada → PDF | `no-image` |
| `merge_pdfs` | `fileName?` | Junta os PDFs anexados à citada e à mensagem, nessa ordem, até 50 MB. Diferente do `!mergepdf`, não guarda fila entre mensagens | `need-two-pdfs`, `too-large` |

## Capabilities

O plugin exige `media.download` e `send.document`. Não usa o FFmpeg.

## Limites

| O quê | Limite | Por quê |
| --- | --- | --- |
| Prazo dos comandos | 60 s | O padrão do bot é curto para um PDF grande |
| Lista do `!mergepdf` | 50 MB por pessoa; some 30 min depois do último PDF | Vive em memória |

A lista do `!mergepdf` fica em memória: um restart a esvazia. O `!mergepdf` fica na fila do
chat, para o `done` não passar à frente do último PDF adicionado.

## Textos

Em `messages`, sobrescrevíveis pela config (`mergeFull` → `BRIDGER_PDF__MESSAGES__MERGE_FULL`).
`{prefix}` vira o prefixo do chat e o `mergeAdded` recebe `{count}`, o tamanho da lista. A
sobrescrita só pode usar os placeholders do texto padrão.
