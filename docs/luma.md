# luma

A personagem: responde em conversa privada, quando citada, chamada pelo nome ou mencionada, com
histórico, persona por chat e as ferramentas do ponto `ai.tools`. A IA em si (cadeia de
modelos, fallback, métricas) é do [`ai`](ai.md); a `luma` depende dele. Código em
`src/plugins/luma/`: `luma.ts` (plugin), `transcript.ts`, `trigger.ts`, `prompt.ts`, `personas.ts`,
`persona-generator.ts`, `stats.ts`, `media.ts` (mídia pelo ID e a tool `view_media`) e `read-pdf.ts`
(a tool `read_pdf`), todos puros menos o primeiro e os dois últimos.

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

## Memória longa

A transcrição some em 2 h; fatos duráveis ("o João é corintiano", "a Bia não gosta de ser chamada
de Bianca") ficam em **blocos** no storage (coleção `memory`), no estilo da core memory do Letta.

- Cada chat tem um bloco **do chat** (combinados, piadas internas) e um bloco **por pessoa** que
  fala nele. Tudo é por chat: o que alguém conta no privado nunca aparece no grupo, nem o
  contrário.
- Cada bloco tem até `memory.blockChars` (500) caracteres. Cheio, o `remember` recusa com os fatos
  que ele tem, e a Luma esquece algum antes.
- Os blocos entram no **fim da instrução de sistema** (`# O que você lembra deste chat`): o do chat
  e os de quem está na transcrição ou fala agora, em ordem fixa. Mudam só quando ela lembra ou
  esquece, ou quando alguém com bloco entra na conversa, então o começo do prompt segue em cache.
- A própria Luma edita os blocos pelas tools `remember` e `forget`. A pessoa é achada pelo nome:
  quem falou nas últimas horas ou quem já tem bloco no chat.
- **Retenção:** um fato sai depois de `memory.maxAgeDays` (180) dias sem ser lembrado de novo;
  lembrar o mesmo fato renova o prazo. A expiração é feita na leitura, sem timer.
- `!luma clear` e a tool `clear_history` apagam também os blocos do chat. Criar persona só limpa a
  transcrição.
- Se o storage falha na leitura (`luma.memory.failed`), a Luma responde sem a memória.

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
| `luma.memory.remember` / `.forget` | A tool `remember` guardou ou a `forget` apagou um fato; alvo = chat | `block` (`chat` ou `person`), nunca o fato nem de quem é |

## Comandos

| Comando | O que faz |
| --- | --- |
| `!luma clear` (`!lc`, `!clear`) | Esquece a transcrição e a memória longa do chat (em grupo, para todos) |
| `!luma stats` (`!ls`) | Conversas ativas e, se o [`ai-metrics`](ai-metrics.md) está carregado, respostas, taxa de sucesso, fallbacks, tokens (e a parte da entrada que veio do cache, quando houve), latência e custo dos últimos 7 dias |

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)).

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `clear_history` | — | Apaga a transcrição e a memória longa do chat (em grupo, a de todos) | — |
| `remember` | `fact` (até 200), `person?` | Guarda o fato no bloco da pessoa (pelo nome) ou, sem `person`, no do chat. Fato repetido renova o prazo | `unknown-person` (com o nome), `full` (com os fatos do bloco em `detail`) |
| `forget` | `fact?`, `person?` | Apaga do bloco os fatos que contêm `fact` (sem acento nem caixa); sem `fact`, o bloco inteiro | `unknown-person`, `not-found` (com os fatos do bloco em `detail`) |
| `create_persona` | `description` | Cria e ativa a persona; confirma no chat | `empty`, `limit`, `invalid-persona`, `unavailable` |
| `read_messages` | `ids` (1 a 10, `#m12`) | Devolve o texto inteiro de falas anteriores do chat pelo ID (a cortada no nível 1, a citada no resumo). Só leitura | `unknown` (com o ID em `detail`) |
| `view_media` | `ids` (1 a 4, `#m12`), `question?` | Olha imagens ou figurinhas anteriores do chat pelo ID e devolve a descrição. Só leitura | `unknown`, `no-media`, `view-once`, `not-image`, `too-large`, `expired` (com o ID em `detail`) |
| `read_pdf` | `ids?` (até 4, `#m12`), `pages?` (`"3-7"`, `"5"`, `"10-"`), `question?` | Lê PDFs do chat e devolve o texto por página; sem `ids`, o da mensagem e o da citada. Só leitura ([PDF](#pdf)) | `no-pdf`, `unknown`, `no-media`, `view-once`, `not-pdf`, `too-large`, `expired`, `encrypted`, `invalid`, `invalid-pages` (com o total de páginas), `no-text` (com o ID em `detail`) |

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
- **Documento** aparece na transcrição com o nome do arquivo (`[documento: contrato.pdf]`), sem
  colchete nem quebra de linha e com até 80 caracteres. É assim que a Luma sabe qual ID é PDF.
- Outras tools usam a mídia pelo serviço (`media(chatId, id)`): o
  [`edit_sticker`](sticker-edit.md#tool-da-ia) junta figurinhas anteriores por ID.

## PDF

A `read_pdf` tira o texto do PDF localmente, pelo PDF.js ([`unpdf`](https://github.com/unjs/unpdf)),
sem custo de IA. O DeepSeek, modelo da conversa, não lê PDF; texto ele lê.

- Até **30 mil caracteres**, o texto vai cru ao modelo, com um cabeçalho por PDF
  (`--- #m4 contrato.pdf, p. 1-12 de 12 ---`) e `[p. N]` antes de cada página. É o que serve
  para perguntas de seguimento.
- Acima disso, uma chamada à parte (`purpose: luma.pdf`, cadeia `models`) resume e responde à
  `question`, lendo no máximo 200 mil caracteres. O resultado traz o total de páginas, e a Luma
  pede um trecho por `pages`.
- **PDF escaneado** (nenhuma página com texto) vai como arquivo `application/pdf` à cadeia
  `visionModels`, que precisa aceitar PDF (o Gemini aceita). Sem `visionModels`, volta `no-text`.
- PDF de até **20 MB**; PDF com senha volta `encrypted`, e arquivo corrompido, `invalid`.
- O texto **não é guardado**: a cada pergunta a Luma lê de novo pelo ID, enquanto a fala estiver
  na transcrição. As chamadas à parte entram no uso de quem pediu (`actor`), e a tool registra
  `pdf`/`read` no [`usage`](usage.md).

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
| `memory.blockChars` / `memory.maxAgeDays` | `500` / `180` | Tamanho de cada bloco da [memória longa](#memória-longa) e dias de um fato sem ser lembrado |
| `maxPartLength` / `maxParts` | `300` / `2` | Tamanho de cada balão e quantos no máximo |
| `thinkingDelayMs` | `{ min: 2000, max: 5000 }` | Espera "digitando" antes de gerar; `0` desliga |
| `replyTimeoutMs` | `180000` | Prazo da resposta inteira |
| `timeZone` | `America/Sao_Paulo` | Fuso em que ela lê a data e a hora |
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
clearHistory(message)
media(chatId, id)   // { found: true, type, media } | { found: false, reason: 'unknown' | 'no-media' | 'view-once' }
```

Uso opcional de outros plugins: `ctx.services.has('luma')`.

## Uso opcional de outros plugins

Sem `dependsOn`, na hora do uso: o [`usage`](usage.md) registra a resposta (o
[`rank`](rank.md) conta por ele), o `user-names` dá o nome de quem fala, e o [`ai-metrics`](ai-metrics.md) alimenta o
`!luma stats`.
