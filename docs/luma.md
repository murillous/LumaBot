# luma

A personagem: responde em conversa privada, quando citada, chamada pelo nome ou mencionada, com
persona por chat e as ferramentas do ponto `ai.tools`. A IA em si (cadeia de modelos, fallback,
métricas) é do [`ai`](ai.md); a transcrição, o orçamento, a memória longa e as tools de contexto
(`read_messages`, `view_media`, `read_pdf`, `remember`, `forget`, `clear_history`) são do
[`ai-context`](ai-context.md). A `luma` depende dos dois. Código em `src/plugins/luma/`:
`luma.ts` (plugin), `trigger.ts`, `prompt.ts`, `personas.ts`, `persona-generator.ts` e
`stats.ts`, todos puros menos o primeiro.

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

## Contexto

A Luma lê a conversa pelo [`ai-context`](ai-context.md): a transcrição do chat com IDs (`#m12`),
o resumo das falas velhas e a memória longa em blocos. O que é só dela:

- A instrução de sistema é a persona, as regras, as ferramentas e o formato do WhatsApp, com o
  guia de leitura e a seção de memória do `ai-context` no meio e no fim, com os textos e a config
  dele (`messages`, `memory.enabled`). Não muda entre os turnos do mesmo chat e persona, para o
  cache do provider valer.
- O resumo usa a cadeia da Luma (`models`), como a resposta.
- A resposta dela entra na transcrição como foi ao chat, com o ID de cada balão: quem citar
  qualquer um deles cita a fala.
- `!luma clear` esquece a conversa e a memória longa do chat; criar ou trocar de persona esquece
  só a conversa.
- **Migração:** a memória longa era guardada no storage da Luma. No boot, ela passa os fatos que
  ainda tiver para o `ai-context` e apaga os dela; fato que o bloco já tem não entra de novo. Se
  falhar (`luma.memory-migration.failed`), tenta no próximo boot.

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
| `luma.history.clear` | `!luma clear`; alvo = chat | — (quem pediu é o ator `contact` do evento) |

A tool `clear_history` e a memória longa auditam pelo [`ai-context`](ai-context.md#auditoria).

## Comandos

| Comando | O que faz |
| --- | --- |
| `!luma clear` (`!lc`, `!clear`) | Esquece a transcrição e a memória longa do chat (em grupo, para todos) |
| `!luma stats` (`!ls`) | Conversas ativas e, se o [`ai-metrics`](ai-metrics.md) está carregado, respostas, taxa de sucesso, fallbacks, tokens (e a parte da entrada que veio do cache, quando houve), latência e custo dos últimos 7 dias |

## Tools da IA

Contribuída ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). As de contexto são do
[`ai-context`](ai-context.md#tools-da-ia).

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `create_persona` | `description` | Cria e ativa a persona; confirma no chat | `empty`, `limit`, `invalid-persona`, `unavailable` |

Trocar de persona ou limpar a memória por tool (`create_persona` ou a `clear_history` do
`ai-context`) é recomeçar: a troca em curso **não** é guardada no histórico, para a fala da persona
anterior não vazar para a nova.

## Mídia

- **Imagem ou figurinha** (da mensagem ou da citada) vai ao modelo como parte da última mensagem,
  até 8 MB. Para modelos sem visão (o DeepSeek), `visionModels` troca a cadeia só nessas
  mensagens. Figurinha sozinha pede para reagir à emoção dela.
- **Áudio**: a Luma sabe que ouve pela tool `transcribe_audio` do plugin
  [`transcribe`](transcribe.md); a transcrição vai só ao modelo. Sem esse plugin, ela sabe que não
  consegue ouvir.
- A mensagem **citada** que já saiu da transcrição entra na fala pelo texto (`[citando Ana: "..."]`).
- Mídia anterior pelo ID, `view_media` e PDF: [`ai-context`](ai-context.md#mídia-anterior-pelo-id).

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `names` | `["luma"]` | Nomes que chamam a Luma, como palavra inteira |
| `models` | `[]` | Cadeia só da Luma, no formato do `ai`. Vazio usa a principal |
| `visionModels` | `[]` | Cadeia para mensagem com imagem. Vazio usa `models`. O `view_media` e o PDF escaneado usam o `visionModels` do [`ai-context`](ai-context.md#config-mínima) |
| `defaultPersona` | `pensadora` | Persona de um chat que nunca escolheu |
| `maxCustomPersonas` | `10` | Personas criadas por chat |
| `maxPartLength` / `maxParts` | `300` / `2` | Tamanho de cada balão e quantos no máximo |
| `thinkingDelayMs` | `{ min: 2000, max: 5000 }` | Espera "digitando" antes de gerar; `0` desliga |
| `replyTimeoutMs` | `180000` | Prazo da resposta inteira |
| `boredReplies`, `errorReplies` | frases do legacy | Variantes sorteadas (config, não `messages`, por serem listas) |

## Cenários de conversa

Mudança de prompt ou de contexto quebra comportamento em silêncio. Os cenários em
`src/plugins/luma/scenarios.ts` são conversas roteirizadas: as falas antes, o pedido e o critério
da resposta. Cada fase do redesenho do contexto tem os seus:

| Fase | Cenário | Critério |
| --- | --- | --- |
| Transcrição única | o que você disse pra Bia? | repete o que respondeu a outra pessoa |
| Transcrição única | continuação de "sim" | o "sim" citando uma fala dela responde a ela |
| Transcrição única | mudança de assunto | responde a pergunta nova, não o assunto de antes |
| Mídia por ID | juntar figurinhas por ID | `edit_sticker` com a 2ª como base e a 1ª como referência |
| Orçamento | textão antigo lido pelo ID | acha, pelo `read_messages`, o dado no fim de um textão cortado |
| Memória longa | fato lembrado depois do restart | o fato volta sem a transcrição |
| PDF (#478) | pergunta sobre um PDF do chat | acha, pela `read_pdf`, a multa no PDF que outra pessoa mandou |

- **No `pnpm test`** (`scenarios.test.ts`), com o modelo falso respondendo o que um modelo que
  acerta responderia: confere o contexto que a Luma monta (o modelo só acerta se ele estiver lá) e
  o caminho das tools.
- **Contra o modelo real**, `pnpm evals:luma [filtro]` roda os mesmos cenários com a cadeia e as
  chaves que o bot usa: as que o dashboard salvou no banco (`LUMABOT_DB`, decifradas com a
  `BRIDGER_SECRET_KEY` ou o `data/secret.key`) e, por cima, as `BRIDGER_AI__*` do `.env`. Mostra
  a resposta de cada um e sai com código 1 se algum reprovar. O modelo de imagem segue falso.
  Gasta tokens; o filtro escolhe cenários pelo nome.
- Cada cenário roda numa cópia do banco feita com o bot rodando ou não, e a cópia é apagada no
  fim: a conversa de teste não chega ao banco do bot.

Cenário novo é um item em `SCENARIOS`, com o `fake` (as respostas certas), o `context` e o
`outcome`.

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
clearHistory(message)   // esquece a conversa do chat; a memória longa fica
```

Uso opcional de outros plugins: `ctx.services.has('luma')`.

## Uso opcional de outros plugins

Sem `dependsOn`, na hora do uso: o [`usage`](usage.md) registra a resposta (o
[`rank`](rank.md) conta por ele), o `user-names` dá o nome de quem fala, e o [`ai-metrics`](ai-metrics.md) alimenta o
`!luma stats`.
