# luma

A personagem: responde em conversa privada, quando citada, chamada pelo nome ou mencionada, com
histórico, persona por chat e as ferramentas do ponto `ai.tools`
([ADR 0005](../../../docs/adr/0005-a-luma-e-um-plugin-a-parte-do-ai.md)). A IA em si (cadeia de
modelos, fallback, métricas) é do [`ai`](ai.md); a `luma` depende dele. Código em
`src/plugins/luma/`: `luma.ts` (plugin), `history.ts`, `trigger.ts`, `prompt.ts`, `personas.ts`,
`persona-generator.ts` e `stats.ts`, todos puros menos o primeiro.

## Quando responde

Para toda mensagem que nenhum comando consumiu e que não veio de outro bot:

| Onde | Responde quando |
| --- | --- |
| Conversa privada | Sempre |
| Grupo | A mensagem **cita** uma fala da Luma, **tem o nome dela** (`names`, em qualquer ponto do texto) ou **menciona** a Luma |

Ao decidir responder, a Luma **reivindica** a mensagem (`claim()`) antes de qualquer `await`, para
o [`spontaneous`](spontaneous.md) não reagir à mesma mensagem. Mensagem de grupo que não é com ela
entra na janela de contexto e fica por isso.

A fala que chamou a Luma perde o nome do começo (`Ei Luma, que horas são?` vira `que horas são?`).
Chamada sem dizer nada responde uma frase de `boredReplies`, sem gastar a IA.

## Memória

- **Histórico**: os últimos `history.maxMessages` turnos (padrão 80, fala e resposta contam dois)
  de uma conversa, que dura `history.maxAgeMs` (2 h) sem falas. A conversa é o chat privado ou, em
  grupo, **uma pessoa naquele grupo**: o que a Ana disse não entra na memória da Bia.
- **Clima do grupo**: as últimas `groupContextSize` (15) falas do grupo, **antes** da que chamou a
  Luma, vão na instrução de sistema como contexto ambiente que não foi endereçado a ela.
- Tudo em **memória**, sem timer: a expiração é feita na leitura. Um restart esquece as conversas,
  como o legacy.

## Persona

Cinco de fábrica (Pensadora, a padrão, Pistola, Good Vibes, Sênior e Literal, em `personas.ts`) e as
que o chat cria. A ativa de cada chat fica no storage (`persona:<chat>`); apagar a ativa volta
para a padrão.

| Comando | O que faz |
| --- | --- |
| `!persona` | Menu com a atual, as marcas (⭐ padrão, 🗑️ criada no chat) e uma ação por persona. Com botões, o clique roda `!persona usar <chave>`; sem eles, o kernel acrescenta o menu numerado e o número respondido roda a ação |
| `!persona <n>` / `<nome>` / `pN` | Troca a persona (`2`, `p2`, `pistola`, `Luma Pistola`) |
| `!persona criar <descrição>` | A IA gera a persona da descrição (`name`, `description`, `context`, `style`, 3 a 8 `traits`), o chat a ativa e a memória é limpa. JSON malformado tenta uma segunda vez |
| `!persona deletar <n>` | Apaga uma persona **criada** no chat; as de fábrica são recusadas |

Cada chat pode criar até `maxCustomPersonas` (10). O traço de formato dos balões (`MENSAGENS
CURTAS...`) é do sistema e entra em toda persona gerada; o modelo nunca o escreve.

## Comandos

| Comando | O que faz |
| --- | --- |
| `!luma clear` (`!lc`, `!clear`) | Esquece a conversa de quem pediu e a janela do chat |
| `!luma stats` (`!ls`) | Conversas ativas e, se o [`ai-metrics`](ai-metrics.md) está carregado, respostas, taxa de sucesso, fallbacks, tokens, latência e custo dos últimos 7 dias |

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)).

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `clear_history` | — | Apaga a memória da conversa de quem está falando | — |
| `create_persona` | `description` | Cria e ativa a persona; confirma no chat | `empty`, `limit`, `invalid-persona`, `unavailable` |

Trocar de persona ou limpar a memória por tool é recomeçar: a troca em curso **não** é guardada no
histórico, para a fala da persona anterior não vazar para a nova.

## Mídia

- **Imagem ou figurinha** (da mensagem ou da citada) vai ao modelo como parte da última mensagem,
  até 8 MB. Para modelos sem visão (o DeepSeek), `visionModels` troca a cadeia só nessas
  mensagens. Figurinha sozinha pede para reagir à emoção dela.
- **Áudio**: a Luma sabe que ouve pela tool `transcribe_audio` do plugin
  [`transcribe`](transcribe.md); a transcrição vai só ao modelo. Sem esse plugin, ela sabe que não
  consegue ouvir.
- A mensagem **citada** entra na fala (`[citando Ana: "..."]`); citar a última fala dela, que já
  está no histórico, não acrescenta nada.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `names` | `["luma"]` | Nomes que chamam a Luma, como palavra inteira |
| `models` | `[]` | Cadeia só da Luma, no formato do `ai`. Vazio usa a principal |
| `visionModels` | `[]` | Cadeia para mensagem com imagem. Vazio usa `models` |
| `defaultPersona` | `pensadora` | Persona de um chat que nunca escolheu |
| `maxCustomPersonas` | `10` | Personas criadas por chat |
| `history.maxMessages` / `history.maxAgeMs` | `80` / `7200000` | Tamanho e validade da conversa |
| `groupContextSize` | `15` | Falas do grupo lidas como clima |
| `maxPartLength` / `maxParts` | `300` / `2` | Tamanho de cada balão e quantos no máximo |
| `thinkingDelayMs` | `{ min: 2000, max: 5000 }` | Espera "digitando" antes de gerar; `0` desliga |
| `replyTimeoutMs` | `180000` | Prazo da resposta inteira |
| `timeZone` | `America/Sao_Paulo` | Fuso em que ela lê a data e a hora |
| `boredReplies`, `errorReplies` | frases do legacy | Variantes sorteadas (config, não `messages`, por serem listas) |

## `messages`

`historyCleared`, `lumaUsage`, `unavailable` e os textos da persona (`personaHeader`,
`personaCurrent`, `personaFooter`, `markDefault`, `markCustom`, `personaChanged`, `personaInvalid`,
`personaCreateHelp`, `personaLimit`, `personaCreateOk`, `personaCreateFail`, `personaDeleteOk`,
`personaDeleteActive`, `personaDeletePredefined`) e do `!luma stats` (`stats*`). `{prefix}` é o
prefixo do chat.

## Falhas

IA fora do ar ou sem cadeia configurada (`AiUnavailableError`) responde `unavailable`; qualquer
outro erro responde uma frase de `errorReplies` e vai para o log. A causa nunca vai ao chat.

## Serviço `luma`

```ts
personas.list(chatId) / active(chatId) / select(chatId, key) / create(chatId, description, signal?) / remove(chatId, key)
clearHistory(message)
```

Uso opcional de outros plugins: `ctx.services.has('luma')`.

## Uso opcional de outros plugins

Sem `dependsOn`, na hora do uso (ADR 0002 item 7): o [`rank`](rank.md) conta a interação
(`record`), o `user-names` dá o nome de quem fala, e o [`ai-metrics`](ai-metrics.md) alimenta o
`!luma stats`.
