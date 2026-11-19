# polls

Enquetes pela IA: a Luma abre uma enquete e conta os votos. Código em `src/plugins/polls/polls.ts`.
Exige a capability `polls` (o Baileys tem); sem ela, o plugin não carrega.

## Como conta

- `create_poll` envia a enquete (`reply.poll`) e grava a pergunta, as opções e o ID da mensagem
  (coleção `polls`).
- O plugin ouve o `poll.vote`, que traz a escolha inteira de quem votou. Ele guarda o voto atual de
  cada pessoa (coleção `votes`): voto novo substitui o anterior, e a lista vazia retira o voto.
- `poll_results` conta a enquete citada ou, sem citação, a última aberta no chat.
- **Só conta enquete que a Luma abriu.** Voto em enquete de outra pessoa é ignorado, porque sem o
  registro dela não há como casar os votos com as opções. Votos dados com o bot desconectado
  também se perdem: a contagem é a do que ele recebeu.

## Tools da IA

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `create_poll` | `question`, `options` (2 a 12), `multiple?` | Abre a enquete no chat (`polls`) | `duplicate-options` |
| `poll_results` | — | Devolve só ao modelo `question`, `voters` (quantas pessoas votaram) e `results` (`option`, `votes` e os nomes em `voters`). Só leitura | `unknown-poll` (citada que não foi ela que abriu), `no-poll` |
