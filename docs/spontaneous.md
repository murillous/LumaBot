# spontaneous

A Luma reage com emoji às mensagens dos grupos, de acordo com o contexto. Código em
`src/plugins/spontaneous/` (`spontaneous.ts` e `decide.ts`, este puro).

## Em resumo

- **Só reação.** O plugin nunca envia texto, figurinha ou mídia: a única saída é `ctx.react`.
- **Decidida pela IA, não por sorteio.** Ela lê as últimas mensagens do chat e escolhe um emoji da
  lista ou `nenhuma`. Resposta fora da lista vale como `nenhuma`.

## Como funciona

Listener de `message` de prioridade `-10` (abaixo da [`luma`](luma.md)), só em grupo, em mensagem
de texto de pessoa:

1. A mensagem entra na janela de `window` mensagens do chat (em memória), mesmo as reivindicadas.
2. Não age se `e.claimed` (a Luma ou outro listener já a reivindicou), se o remetente é bot ou se
   o transport não tem `reactions` (não gasta a IA à toa).
3. Sorteia: só segue com probabilidade `chance`. A mensagem sorteada fora não consome o cooldown.
4. Respeita o cooldown: no máximo uma avaliação por chat a cada `cooldownMs`.
5. Pede ao [`ai`](ai.md) (`purpose: 'spontaneous'`) o emoji, **fora da fila do chat** (esperar a IA
   seguraria comandos e a Luma). O prazo (`timeoutMs`) e o descarte do plugin a cancelam.
6. Se a resposta é exatamente um emoji da lista, reage. Falha da IA vai para o log em `warn`.

O cooldown conta quando a avaliação **começa**, também quando a IA falha. O plugin depende do `ai`.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `window` | `15` | Mensagens recentes de cada chat que a IA lê |
| `chance` | `0.05` | Probabilidade (0 a 1) de uma mensagem ser avaliada |
| `cooldownMs` | `60000` | Tempo mínimo entre duas avaliações no mesmo chat |
| `emojis` | `😂 💀 😭 🤔 👀 😳 🗿 💅` | Emojis que a IA pode usar |
| `models` | `[]` | Cadeia só desta decisão, no formato do `ai`. Vazio usa a principal |
| `timeoutMs` | `30000` | Prazo da avaliação inteira |

## Por plataforma

Reagir às mensagens do grupo exige **ver todas elas**. No Telegram, com o privacy mode ligado, o bot
só vê comandos, menções e respostas a ele; no Discord, ler mensagens exige a intent Message Content.
Sem isso o plugin sobe e nunca avalia (#284 prevê uma capability para isso).
