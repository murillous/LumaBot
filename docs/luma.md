# luma

A personagem: responde em conversa privada, quando citada, chamada pelo nome ou mencionada, com
histórico, persona por chat e as ferramentas do ponto `ai.tools`. A IA em si (cadeia de
modelos, fallback, métricas) é do [`ai`](ai.md); a `luma` depende dele. Código em
`src/plugins/luma/`: `luma.ts` (plugin), `transcript.ts`, `trigger.ts`, `prompt.ts`, `personas.ts`,
`persona-generator.ts`, `stats.ts` e `media.ts` (mídia pelo ID e a tool `view_media`), todos puros menos o primeiro e o último.

## Quando responde

Para toda mensagem que nenhum comando consumiu e que não veio de outro bot:

| Onde | Responde quando |
| --- | --- |
| Conversa privada | Sempre |
| Grupo | A mensagem **cita** uma fala da Luma, **tem o nome dela** (`names`, em qualquer ponto do texto) ou **menciona** a Luma |

Ao decidir responder, a Luma **reivindica** a mensagem (`claim()`) antes de qualquer `await`, para
o [`spontaneous`](spontaneous.md) não reagir à mesma mensagem. Mensagem de grupo que não é com ela
entra na transcrição do chat e fica por isso.

A fala que chamou a Luma perde o nome do começo (`Ei Luma, que horas são?` vira `que horas são?`).
Chamada sem dizer nada responde uma frase de `boredReplies`, sem gastar a IA.

## Memória

A Luma lê uma **transcrição por chat**: tudo o que se disse nele, inclusive as falas dela. Em grupo,
a conversa é uma só, para ela saber quem disse o quê e o que ela mesma respondeu a cada pessoa. O
privado continua isolado: um chat, uma conversa.

- Cada fala ganha um **ID curto** (`#m12`) e vai ao modelo como `[#m12 16:30] Ana: fala`. As falas
  seguidas das pessoas viram um turno `user`; as dela, um turno `assistant` só com o texto.
- A fala que chamou a Luma é a última, marcada com `➜`.
- A **mídia** aparece como marca (`[figurinha]`, `[imagem]`, `[áudio]`, `[vídeo]`,
  `[documento]`). Só a imagem da fala de agora (ou da citada) vai ao modelo de fato.
- A **citação** de uma fala que ainda está na transcrição vira o ID (`(respondendo #m9)`). Citar
  uma fala dela mostra um trecho do que ela disse (`(respondendo à sua fala "...")`). Citar a
  última fala dela não acrescenta nada, porque é continuação.
- Guarda as últimas `history.maxMessages` (80) falas do chat, e cada fala sai depois de
  `history.maxAgeMs` (2 h).
- Tudo em **memória**, sem timer: a expiração é feita na leitura. Um restart esquece as conversas.

## Prompt cacheável e orçamento

O provider guarda em cache o começo do prompt que se repete entre chamadas (o DeepSeek, o Gemini e
a OpenAI fazem isso sozinhos). Para valer, a **instrução de sistema não muda entre os turnos** do
mesmo chat e persona: só a identidade, as regras, o formato e o fuso. O que muda a cada turno vai
nas mensagens:

- o dia de hoje, numa linha `[hoje é terça-feira, 17/11/2026]` antes da fala de agora (a hora já
  está no cabeçalho dela);
- a imagem, anexada à fala de agora;
- o resumo da conversa, como primeira fala.

A transcrição que vai ao modelo cabe em `history.maxTokens` (3000), estimados em 3 caracteres por
token. A transcrição em si não muda: o que sai do prompt continua achável pelo ID.

1. **Nível 1, sem modelo.** Fora das 10 falas mais recentes, o texto de uma pessoa com mais de 400
   caracteres vira um trecho terminado em `…[cortado]`. A mídia já é só a marca com o ID. A Luma lê
   o texto inteiro pela tool `read_messages`.
2. **Nível 2, com modelo.** Passando do orçamento, as falas mais velhas viram um **resumo rolante**
   (quem, assuntos em aberto, combinados, piadas internas), que cita os IDs. Ele dobra falas até
   o resto ocupar metade do orçamento, então não roda a cada turno. Roda durante o "digitando",
   com a cadeia da Luma (`purpose: luma.compact`), no uso de quem a chamou. Vai ao modelo como
   `[resumo da conversa até aqui]` e vive enquanto a fala mais nova que ele cobre viveria (2 h).
   `!luma clear` e a criação de persona o apagam junto.
3. Se o resumo falha (`luma.compact.failed`), a resposta segue só com as falas mais recentes que
   cabem no orçamento.

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

Cada chat pode criar até `maxCustomPersonas` (10). O traço de formato dos balões (`mensagens
curtas...`) é do sistema e entra em toda persona gerada; o modelo nunca o escreve.

## Auditoria

Registra no log de auditoria do kernel (`ctx.audit`) só o ato administrativo, nunca a conversa:

| Ação | Quando | `details` |
| --- | --- | --- |
| `luma.persona.set` / `.create` / `.delete` | Troca, criação ou remoção de persona (comando ou tool); alvo = chat | `key` (e `wasActive` no delete), nunca o texto da persona |
| `luma.history.clear` | `!luma clear` ou a tool `clear_history`; alvo = chat | — (quem pediu é o ator `contact` do evento) |

## Comandos

| Comando | O que faz |
| --- | --- |
| `!luma clear` (`!lc`, `!clear`) | Esquece a transcrição do chat (em grupo, para todos) |
| `!luma stats` (`!ls`) | Conversas ativas e, se o [`ai-metrics`](ai-metrics.md) está carregado, respostas, taxa de sucesso, fallbacks, tokens (e a parte da entrada que veio do cache, quando houve), latência e custo dos últimos 7 dias |

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)).

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `clear_history` | — | Apaga a transcrição do chat (em grupo, a de todos) | — |
| `create_persona` | `description` | Cria e ativa a persona; confirma no chat | `empty`, `limit`, `invalid-persona`, `unavailable` |
| `read_messages` | `ids` (1 a 10, `#m12`) | Devolve o texto inteiro de falas anteriores do chat pelo ID (a cortada no nível 1, a citada no resumo). Só leitura | `unknown` (com o ID em `detail`) |
| `view_media` | `ids` (1 a 4, `#m12`), `question?` | Olha imagens ou figurinhas anteriores do chat pelo ID e devolve a descrição. Só leitura | `unknown`, `no-media`, `view-once`, `not-image`, `too-large`, `expired` (com o ID em `detail`) |

Trocar de persona ou limpar a memória por tool é recomeçar: a troca em curso **não** é guardada no
histórico, para a fala da persona anterior não vazar para a nova.

## Mídia

- **Imagem ou figurinha** (da mensagem ou da citada) vai ao modelo como parte da última mensagem,
  até 8 MB. Para modelos sem visão (o DeepSeek), `visionModels` troca a cadeia só nessas
  mensagens. Figurinha sozinha pede para reagir à emoção dela.
- **Áudio**: a Luma sabe que ouve pela tool `transcribe_audio` do plugin
  [`transcribe`](transcribe.md); a transcrição vai só ao modelo. Sem esse plugin, ela sabe que não
  consegue ouvir.
- A mensagem **citada** que já saiu da transcrição entra na fala pelo texto (`[citando Ana: "..."]`).
- **Mídia anterior, pelo ID.** Cada mídia da transcrição guarda de onde baixar depois, sem a
  mensagem: com a capability `media.ref`, a referência do kernel (`ctx.media.ref`), que o
  transport baixa de novo pelo `ctx.media.fromRef`; sem ela, a própria `Media`, em memória, pelas
  mesmas 2 h. Mídia de visualização única não é guardada. A referência pode conter a chave do
  arquivo: nunca vai para log nem para o modelo.
- `view_media` manda as imagens à cadeia de visão (`visionModels`, ou `models`) numa chamada à
  parte (`purpose: luma.view`, no uso de quem pediu) e devolve só o texto. O modelo da conversa
  pode não ter visão, e a imagem não pesa nos passos seguintes. Mídia que saiu da plataforma
  (`MediaExpiredError`) volta como `expired`.
- Outras tools usam a mídia pelo serviço (`media(chatId, id)`): o
  [`edit_sticker`](sticker-edit.md#tool-da-ia) junta figurinhas anteriores por ID.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `names` | `["luma"]` | Nomes que chamam a Luma, como palavra inteira |
| `models` | `[]` | Cadeia só da Luma, no formato do `ai`. Vazio usa a principal |
| `visionModels` | `[]` | Cadeia para mensagem com imagem. Vazio usa `models` |
| `defaultPersona` | `pensadora` | Persona de um chat que nunca escolheu |
| `maxCustomPersonas` | `10` | Personas criadas por chat |
| `history.maxMessages` / `history.maxAgeMs` | `80` / `7200000` | Falas guardadas por chat e por quanto tempo cada uma fica |
| `history.maxTokens` | `3000` | Tokens estimados da transcrição que vão ao modelo; passando disso, as falas velhas viram resumo ([orçamento](#prompt-cacheável-e-orçamento)) |
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
media(chatId, id)   // { found: true, type, media } | { found: false, reason: 'unknown' | 'no-media' | 'view-once' }
```

Uso opcional de outros plugins: `ctx.services.has('luma')`.

## Uso opcional de outros plugins

Sem `dependsOn`, na hora do uso: o [`usage`](usage.md) registra a resposta (o
[`rank`](rank.md) conta por ele), o `user-names` dá o nome de quem fala, e o [`ai-metrics`](ai-metrics.md) alimenta o
`!luma stats`.
